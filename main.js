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
    seoKeywords: ['印西市', '整体', '肩こり', '腰痛', '骨盤矯正'],
    anthropicAPIKey: process.env.ANTHROPIC_API_KEY,
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

// 手動URL使用のテスト関数
async function testManualUrls() {
    console.log('\n=== 手動収集URL使用テスト ===');
    console.log(`手動収集記事数: ${MANUAL_ARTICLE_URLS.length}`);

    if (MANUAL_ARTICLE_URLS.length > 0) {
        console.log('\n--- 最初の5記事URL ---');
        MANUAL_ARTICLE_URLS.slice(0, 5).forEach((url, index) => {
            console.log(`${index + 1}. ${url}`);
        });

        console.log('\n--- 最後の5記事URL ---');
        MANUAL_ARTICLE_URLS.slice(-5).forEach((url, index) => {
            console.log(`${MANUAL_ARTICLE_URLS.length - 4 + index}. ${url}`);
        });
    }

    return MANUAL_ARTICLE_URLS;
}

// 記事内容取得関数（デバッグ版）
async function fetchArticleContent(url) {
    try {
        console.log(`記事取得中: ${url}`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // 複数のセレクターを試行
        const title = $('h1').first().text().trim() ||
            $('[data-testid="post-title"]').text().trim() ||
            $('.post-title').text().trim();

        const content = $('.body.markup').text().trim() ||
            $('[data-testid="post-content"]').text().trim() ||
            $('.post-content').text().trim() ||
            $('article').text().trim() ||
            $('.subtitle').text().trim() ||
            $('p').text().trim();

        // デバッグ情報
        console.log(`  タイトル: "${title}"`);
        console.log(`  内容長: ${content.length}文字`);
        if (content.length > 0) {
            console.log(`  内容開始: "${content.substring(0, 100)}..."`);
        }

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
        '年末年始', 'ゴールデンウィーク', '夏季休暇',
        '定休日', '変更', '休診', '休館', '神社', '奉納'
    ];

    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // タイトルまたは内容にお知らせキーワードが含まれているかチェック
    const isNotice = noticeKeywords.some(keyword =>
        titleLower.includes(keyword) || contentLower.includes(keyword)
    );

    return {
        isNotice: isNotice,
        isArticle: !isNotice,
        type: isNotice ? 'notice' : 'article'
    };
}

// 記事フィルタリング機能
async function filterArticles(urls, maxArticles = 10) {
    console.log('\n=== 記事分類実行中 ===');
    const articles = [];
    const notices = [];

    for (let i = 0; i < Math.min(urls.length, maxArticles); i++) {
        const url = urls[i];
        const content = await fetchArticleContent(url);

        if (content && content.title) {
            const classification = classifyArticle(content.title, content.content);

            if (classification.isArticle) {
                articles.push({ ...content, url });
                console.log(`✓ 記事: ${content.title.substring(0, 50)}...`);
            } else {
                notices.push({ ...content, url });
                console.log(`✗ お知らせ除外: ${content.title.substring(0, 50)}...`);
            }
        }

        // APIレート制限対策で1秒待機
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n=== 分類結果 ===`);
    console.log(`記事: ${articles.length}件`);
    console.log(`お知らせ: ${notices.length}件`);
    console.log(`処理済み: ${Math.min(urls.length, maxArticles)}/${urls.length}件`);

    return { articles, notices };
}

// Claude API要約関数（修正版）
async function summarizeWithClaude(article) {
    try {
        const prompt = `以下のメルマガ記事を、印西市の整体院向けのブログ記事として要約してください。

【重要】記事末尾の以下の宣伝文は要約に含めないでください：
- 「【趣味で作ったアプリのご紹介】」で始まる段落
- 「ClipFlow Video」というアプリの紹介文
- App Storeへのリンク

要約するのは健康・整体に関する本文のみとしてください。

【要約ルール】
- 印西市の地域性を自然に組み込む
- 肩こり、腰痛、整体などの専門用語を自然に使用
- 読みやすさ最優先、SEOは二次的考慮
- 500文字程度で要約
- 整体院の19年実績を活かした内容に

以下の形式で出力してください:
タイトル: [自然で読みやすいタイトル]
本文: [500文字程度の要約]

記事本文：
${article.content}`;

        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.anthropicAPIKey,
                'anthropic-version': '2023-06-01'
            }
        });

        return response.data.content[0].text;

    } catch (error) {
        console.error('Claude API エラー:', error.message);
        return null;
    }
}

// WordPress投稿関数（修正版：categoriesとtags削除）
async function postToWordPress(title, content) {
    try {
        console.log(`WordPress投稿準備: ${title}`);

        // Substack誘導文（QRコード付き）
        const substackPromotion = `

---

この記事の詳細版や最新の健康情報を配信しています。

<div style="text-align: center; margin: 20px 0;">
<img src="https://tanizawaseitai.com/wp-content/uploads/2024/11/qr-code.png" alt="たにざわ整体通信プレミアム QRコード" width="200" height="200" />
</div>

**無料メルマガ登録はこちら**
📧 https://tanizawaseitai.substack.com

整体院の19年の経験をもとにした健康情報をお届けします。
`;

        const fullContent = content + substackPromotion;

        const postData = {
            title: title,
            content: fullContent,
            status: 'draft' // 最初は下書きで安全に投稿
        };

        // 実際のWordPress投稿API呼び出し
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

// バッチ処理関数（投稿履歴管理付き）
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

        // Claude要約
        const summary = await summarizeWithClaude(article);

        if (summary) {
            console.log('Claude要約成功');

            // Claude要約からタイトルと本文を分離
            const titleMatch = summary.match(/タイトル:\s*(.+)/);
            const contentMatch = summary.match(/本文:\s*([\s\S]+)/);
            
            const summarizedTitle = titleMatch ? titleMatch[1].trim() : article.title;
            const summarizedContent = contentMatch ? contentMatch[1].trim() : summary;

            // WordPress投稿
            const postResult = await postToWordPress(summarizedTitle, summarizedContent);

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
                summary: summary,
                postResult: postResult
            });
        } else {
            console.log('✗ Claude要約失敗');
            results.push({
                original: article,
                summary: null,
                postResult: { success: false, error: 'Claude要約失敗' }
            });
        }

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
    // RSS自動取得に切り替え
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
    testManualUrls,
    fetchArticleContent,
    filterArticles,
    summarizeWithClaude,
    postToWordPress,
    processBatch,
    generateReport
};

// メイン実行
main().catch(console.error);