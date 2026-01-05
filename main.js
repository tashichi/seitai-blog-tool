import { MANUAL_ARTICLE_URLS } from './article-urls.js';
import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 投稿履歴管理
import fs from 'fs';

const POSTED_ARTICLES_FILE = 'posted_articles.json';

// 投稿済み記事リストの読み込み
function loadPostedArticles() {
    try {
        if (fs.existsSync(POSTED_ARTICLES_FILE)) {
            const data = fs.readFileSync(POSTED_ARTICLES_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('投稿履歴読み込みエラー:', error.message);
        return [];
    }
}

// 投稿済み記事リストの保存
function savePostedArticles(postedList) {
    try {
        fs.writeFileSync(POSTED_ARTICLES_FILE, JSON.stringify(postedList, null, 2));
        console.log('投稿履歴保存完了');
    } catch (error) {
        console.error('投稿履歴保存エラー:', error.message);
    }
}

// 未投稿記事のフィルタリング
function filterUnpostedArticles(articles) {
    const postedArticles = loadPostedArticles();
    const unposted = articles.filter(article =>
        !postedArticles.some(posted => posted.url === article.url)
    );

    console.log(`\n=== 投稿状況確認 ===`);
    console.log(`全記事数: ${articles.length}`);
    console.log(`投稿済み: ${articles.length - unposted.length}`);
    console.log(`未投稿: ${unposted.length}`);

    return unposted;
}

const CONFIG = {
    substackRSS: 'https://tanizawaseitai.substack.com/feed',
    wordpressAPI: 'https://tanizawaseitai.com/wp-json/wp/v2/posts',
    wordpressAuth: {
        username: 'tanizawaseitai',
        password: 'kBGG CvZL PyAX 9nxG Wmbc PSeG'
    }
};

const parser = new Parser();

// RSSフィード読み込み関数
async function fetchSubstackFeed() {
    try {
        console.log('Substackフィード取得開始...');
        const feed = await parser.parseURL(CONFIG.substackRSS);

        console.log(`RSS取得記事数: ${feed.items.length}`);

        const articles = feed.items.filter(item => {
            const title = item.title.toLowerCase();
            return !title.includes('お知らせ') &&
                !title.includes('休業') &&
                !title.includes('営業時間');
        });

        console.log(`RSS処理対象記事数: ${articles.length}`);
        return articles;

    } catch (error) {
        console.error('RSS取得エラー:', error.message);
        return [];
    }
}

// 記事内容取得関数
// 記事内容取得関数（HTML保持版）
async function fetchArticleContent(url) {
    try {
        console.log(`記事取得中: ${url}`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const title = $('h1').first().text().trim() ||
            $('[data-testid="post-title"]').text().trim() ||
            $('.post-title').text().trim();

        // 🆕 HTMLを保持（改行・段落を維持）
        const content = $('.body.markup').html() ||
            $('[data-testid="post-content"]').html() ||
            $('.post-content').html() ||
            $('article').html() ||
            $('.subtitle').html() ||
            $('p').html();

        console.log(`  タイトル: "${title}"`);
        console.log(`  内容長: ${content ? content.length : 0}文字`);

        return {
            title: title,
            content: content,
            url: url
        };

    } catch (error) {
        console.error(`記事取得エラー (${url}):`, error.message);
        return null;
    }
}

// 記事分類機能（お知らせ vs メルマガ記事）
function classifyArticle(title, content) {
    const noticeKeywords = [
        'お知らせ', '休業', '営業時間', '臨時', '神獅子舞',
        // '年末年始', // 健康記事と区別できないためコメントアウト
        'ゴールデンウィーク', '夏季休暇',
        '定休日', '変更', '休診', '休館', '神社', '奉納'
    ];

    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    const isNotice = noticeKeywords.some(keyword =>
        titleLower.includes(keyword) || contentLower.includes(keyword)
    );

    return {
        isNotice: isNotice,
        isArticle: !isNotice,
        type: isNotice ? 'notice' : 'article'
    };
}

// ========================================
// 🆕 新機能：メルマガ本文をそのまま使用
// ========================================

// アプリ宣伝文を削除する関数
function removeAppPromotion(content) {
    // ClipFlow Videoなどのアプリ宣伝文を削除
    const patterns = [
        /【趣味で作ったアプリのご紹介】[\s\S]*?(?=\n\n|$)/g,
        /ClipFlow Video[\s\S]*?(?=\n\n|$)/g,
        /App Store[\s\S]*?(?=\n\n|$)/g
    ];

    let cleaned = content;
    patterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    return cleaned.trim();
}

// ブログ用にメルマガを整形する関数（超シンプル版）
function prepareForBlog(article) {
    console.log(`記事整形中: ${article.title}`);

    // 1. アプリ宣伝文を削除
    let cleanedContent = removeAppPromotion(article.content);
    console.log(`  整形前: ${article.content.length}文字`);
    console.log(`  整形後: ${cleanedContent.length}文字`);

    // 2. Substack誘導文とCTA（末尾のみ）
    const footer = `

<hr />

<h3>📮 週2回、健康情報をお届けしています</h3>

<div style="text-align: center; margin: 20px 0;">
<img src="https://tanizawaseitai.com/wp-content/uploads/2024/11/qr-code.png" alt="たにざわ整体通信 QRコード" width="200" height="200" />
</div>

<p><strong>メルマガ登録はこちら</strong><br>
📧 <a href="https://tanizawaseitai.substack.com" target="_blank">https://tanizawaseitai.substack.com</a></p>

<hr />

<h3>🏥 印西市で整体をお探しなら</h3>

<p><strong>たにざわ整体</strong>（2005年開業）<br>
📞 0476-33-6243<br>
🔗 <a href="https://tanizawaseitai.com/contact/">ご予約・お問い合わせ</a><br>
⭐ Google評価 4.9 / 口コミ多数</p>

<p>肩こり・腰痛・産後骨盤矯正など、お気軽にご相談ください。</p>
`;

    // 3. メルマガ本文 + 末尾CTAのみ（冒頭導入文なし）
    const blogPost = cleanedContent + footer;

    return {
        title: article.title,
        content: blogPost,
        url: article.url
    };
}

// WordPress投稿関数（シンプル版）
async function postToWordPress(title, content) {
    try {
        console.log(`WordPress投稿準備: ${title}`);

        const postData = {
            title: title,
            content: content,
            status: 'draft' // 下書きとして投稿
        };

        const response = await axios.post(CONFIG.wordpressAPI, postData, {
            auth: {
                username: CONFIG.wordpressAuth.username,
                password: CONFIG.wordpressAuth.password
            }
        });

        console.log('WordPress投稿成功:', response.data.id);
        return {
            success: true,
            data: response.data,
            postId: response.data.id,
            editUrl: `https://tanizawaseitai.com/wp-admin/post.php?post=${response.data.id}&action=edit`
        };

    } catch (error) {
        console.error('WordPress投稿エラー:', error.message);
        return { success: false, error: error.message };
    }
}

// バッチ処理関数（シンプル版 - Claude要約なし）
async function processBatch(articles, startIndex = 0, batchSize = 10) {
    const postedArticles = loadPostedArticles();

    console.log(`\n=== バッチ処理開始 (最大${batchSize}件処理) ===`);

    const results = [];
    let processed = 0;

    for (let i = startIndex; i < articles.length && processed < batchSize; i++) {
        const article = articles[i];

        // 投稿済みチェック
        const isAlreadyPosted = postedArticles.some(posted => posted.url === article.url);
        if (isAlreadyPosted) {
            console.log(`[スキップ] 投稿済み: ${article.title}`);
            continue;
        }

        console.log(`\n[${processed + 1}/${batchSize}] 処理中: ${article.title}`);

        // メルマガをブログ用に整形（アプリ宣伝文削除 + 末尾CTA追加）
        const blogArticle = prepareForBlog(article);
        console.log('記事整形完了');

        // WordPress投稿
        const postResult = await postToWordPress(blogArticle.title, blogArticle.content);

        if (postResult.success) {
            // 投稿成功時は履歴に追加
            postedArticles.push({
                url: article.url,
                title: article.title,
                wordpressId: postResult.postId,
                postedAt: new Date().toISOString()
            });
            savePostedArticles(postedArticles);
            console.log(`✓ WordPress投稿成功: ${postResult.editUrl}`);
        } else {
            console.log(`✗ WordPress投稿失敗: ${postResult.error}`);
        }

        results.push({
            original: article,
            postResult: postResult
        });

        processed++;

        // APIレート制限対策
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\nバッチ処理完了: ${results.length}件処理済み`);
    return results;
}

// 処理結果レポート生成
function generateReport(results) {
    console.log('\n=== 処理結果レポート ===');

    const successful = results.filter(r => r.postResult.success);
    const failed = results.filter(r => !r.postResult.success);

    console.log(`成功: ${successful.length}件`);
    console.log(`失敗: ${failed.length}件`);

    if (successful.length > 0) {
        console.log('\n=== 投稿成功記事 ===');
        successful.forEach((result, index) => {
            console.log(`${index + 1}. ${result.original.title}`);
            console.log(`   編集URL: ${result.postResult.editUrl}`);
        });
    }

    if (failed.length > 0) {
        console.log('\n=== 投稿失敗記事 ===');
        failed.forEach((result, index) => {
            console.log(`${index + 1}. ${result.original.title}`);
            console.log(`   エラー: ${result.postResult.error}`);
        });
    }
}

// メイン実行関数（RSS自動取得版）
async function main() {
    console.log('\n=== RSS自動取得モード ===');
    const rssArticles = await fetchSubstackFeed();

    if (rssArticles.length === 0) {
        console.log('RSS記事が取得できませんでした。');
        return;
    }

    console.log(`RSS取得完了: ${rssArticles.length}記事`);

    // RSS記事のURLから本文を直接取得
    const articles = [];
    for (const item of rssArticles) {
        console.log(`記事本文取得中: ${item.title}`);
        const fullContent = await fetchArticleContent(item.link);
        if (fullContent && fullContent.content) {
            articles.push({
                title: item.title,
                content: fullContent.content,
                url: item.link
            });
            console.log(`  本文取得成功: ${fullContent.content.length}文字`);
        } else {
            console.log(`  本文取得失敗`);
        }
        // レート制限対策
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // お知らせ記事を除外
    const healthArticles = articles.filter(article => {
        const classification = classifyArticle(article.title, article.content);
        return classification.isArticle;
    });

    console.log(`\n=== 分類結果 ===`);
    console.log(`健康記事: ${healthArticles.length}件`);
    console.log(`お知らせ除外: ${articles.length - healthArticles.length}件`);

    if (healthArticles.length > 0) {
        console.log('\n=== 健康記事一覧 ===');
        healthArticles.forEach((article, index) => {
            console.log(`${index + 1}. ${article.title}`);
        });

        // 未投稿記事のフィルタリング
        console.log('\n=== 未投稿記事チェック ===');
        const unpostedArticles = filterUnpostedArticles(healthArticles);

        if (unpostedArticles.length > 0) {
            console.log(`新規記事 ${unpostedArticles.length}件を処理します`);
            const results = await processBatch(unpostedArticles, 0, 10);

            // 処理結果レポート
            generateReport(results);

            console.log('\n=== 次のアクション提案 ===');
            console.log('1. 投稿された下書きをWordPress管理画面で確認');
            console.log('2. 内容に問題なければ「公開」に変更');
            if (unpostedArticles.length > 10) {
                console.log('3. 残りの記事処理のため再実行');
            }
        } else {
            console.log('新規記事はありません。すべて投稿済みです。');
        }
    } else {
        console.log('処理対象の健康記事がありません。');
    }
}

// 個別関数のエクスポート（テスト用）
export {
    fetchSubstackFeed,
    fetchArticleContent,
    prepareForBlog,
    postToWordPress,
    processBatch,
    generateReport
};

// メイン実行
main().catch(console.error);