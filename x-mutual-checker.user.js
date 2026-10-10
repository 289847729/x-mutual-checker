// ==UserScript==
// @name         X (Twitter) 互关筛查助手 | X Mutual Follow Checker
// @namespace    https://github.com/mrfan/x-mutual-checker
// @version      1.4.1
// @description  一键筛查 X 账号上哪些人没有回关你（单向关注）、互相关注。双接口精准比对，纯本地安全运行！
// @author       mrfan
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // 清除旧实例，确保热重载生效
  const oldBall = document.getElementById('x-mutual-ball');
  if (oldBall) oldBall.remove();
  const oldModal = document.getElementById('x-mutual-modal');
  if (oldModal) oldModal.remove();

  /* ==========================================================================
     1. 配置
     ========================================================================== */
  const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  // GraphQL Query IDs（Following 列表，用于拉取用户详情）
  const FOLLOWING_QUERY_ID = 'qGZZDF3mp91q7X22s3HxpA';
  const USER_BY_SCREEN_NAME_QUERY_ID = 'Gb-d6r0vxPOADdG62OEBpQ';

  const GRAPHQL_FEATURES = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_basic_info_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false
  };

  const DEFAULT_PAGE_SIZE = 200; // REST 1.1 接口支持最大 200
  const REQUEST_DELAY_MS = 800;

  /* ==========================================================================
     2. 状态管理
     ========================================================================== */
  const state = {
    version: '1.4.1',
    isRunning: false,
    shouldCancel: false,
    currentUser: null,
    followingList: [],
    followersList: [],
    followerIdSet: new Set(),
    followingIdSet: new Set(),
    mutualList: [],
    notFollowingBackList: [],
    fansNotFollowedList: [],
    currentTab: 'not-following-back',
    searchKeyword: '',
  };

  /* ==========================================================================
     3. 工具函数
     ========================================================================== */
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Normalize both current GraphQL UserResults and legacy/REST user objects.
  // Keep this deliberately side-effect free: unavailable users without an ID
  // cannot participate in the follow comparison and are omitted.
  function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw.user && typeof raw.user === 'object' ? raw.user : raw;
    const core = source.core || {};
    const legacy = source.legacy || {};
    const bio = source.profile_bio || {};
    const avatar = source.avatar || {};
    const value = (...values) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
    const rawId = source.rest_id ?? source.id_str ?? source.id ?? core.rest_id ?? core.id_str ?? core.id ?? legacy.id_str ?? legacy.id;
    let id = '';
    if (typeof rawId === 'number') {
      if (!Number.isSafeInteger(rawId) || rawId < 0) return null;
      id = String(rawId);
    } else if (typeof rawId === 'string' && rawId.trim()) {
      id = rawId.trim();
    }
    if (!id) return null;
    const handle = value(core.screen_name, source.screen_name, legacy.screen_name, source.username);
    const name = value(core.name, source.name, legacy.name) || (handle ? handle : `用户 ${id}`);
    const number = (...values) => {
      const n = values.find(v => typeof v === 'number' && Number.isFinite(v));
      return n === undefined ? 0 : n;
    };
    return {
      id,
      name,
      handle,
      bio: value(bio.description, source.description, legacy.description),
      avatar: value(avatar.image_url, source.image_url, source.profile_image_url_https, legacy.profile_image_url_https),
      followersCount: number(core.followers_count, source.followers_count, legacy.followers_count),
      followingCount: number(core.friends_count, source.friends_count, legacy.friends_count)
    };
  }

  function log(msg, detail = '') {
    console.log(`[X-Checker v${state.version}] ${msg}`, detail);
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function getCsrfToken() { return getCookie('ct0'); }

  function getUserIdFromCookie() {
    const twid = getCookie('twid');
    if (!twid) return null;
    const match = twid.match(/u%3D(\d+)/) || twid.match(/u=(\d+)/);
    return match ? match[1] : null;
  }

  function detectCurrentScreenName() {
    // 方法1：侧边栏 Profile 链接
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink?.getAttribute('href')) {
      const handle = profileLink.getAttribute('href').replace(/^\//, '').split('/')[0];
      if (handle && !['home', 'explore', 'notifications', 'messages', 'i', 'settings'].includes(handle)) {
        return handle;
      }
    }
    // 方法2：账号切换按钮
    const accountBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountBtn) {
      const spans = Array.from(accountBtn.querySelectorAll('span'));
      for (const s of spans) {
        if (s.textContent.startsWith('@')) return s.textContent.slice(1).trim();
      }
    }
    return null;
  }

  /* ==========================================================================
     4. 网络层请求
     ========================================================================== */

  // 通用 REST 1.1 请求
  async function fetchRest(path, params = {}) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) throw new Error('未检测到 X 登录态（缺少 ct0 Token）');

    const query = new URLSearchParams(params).toString();
    const url = `https://x.com/i/api/1.1/${path}${query ? '?' + query : ''}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${BEARER_TOKEN}`,
        'x-csrf-token': csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
      },
      credentials: 'include'
    });

    if (res.status === 429) throw new Error('RATE_LIMITED_429');
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch (e) {}
      throw new Error(`HTTP ${res.status}: ${res.statusText} | ${errText.slice(0, 150)}`);
    }

    return res.json();
  }

  // GraphQL 请求（用于 Following 列表，需要头像/简介等详情）
  async function fetchGraphQL(queryId, operationName, variables) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) throw new Error('未检测到 X 登录态（缺少 ct0 Token）');

    const url = `https://x.com/i/api/graphql/${queryId}/${operationName}` +
      `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
      `&features=${encodeURIComponent(JSON.stringify(GRAPHQL_FEATURES))}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${BEARER_TOKEN}`,
        'x-csrf-token': csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'zh-cn'
      },
      credentials: 'include'
    });

    if (res.status === 429) throw new Error('RATE_LIMITED_429');
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch (e) {}
      throw new Error(`HTTP ${res.status}: ${res.statusText} | ${errText.slice(0, 150)}`);
    }

    return res.json();
  }

  /**
   * 直接从页面 DOM 读取当前用户的关注数（最可靠，不依赖 API）
   * X 页面上就显示着 "57 Following"，直接抓取
   */
  function getFriendsCountFromDOM() {
    // 方法1：找含 /following 路径的链接，抓其中的纯数字 span
    const followingLinks = document.querySelectorAll('a[href*="/following"]');
    for (const link of followingLinks) {
      const spans = link.querySelectorAll('span');
      for (const span of spans) {
        const txt = span.textContent.trim().replace(/,/g, '');
        if (/^\d+$/.test(txt)) {
          const n = parseInt(txt, 10);
          if (n > 0) { log('DOM 读取 friends_count', n); return n; }
        }
      }
      // 也尝试直接解析链接全文
      const m = link.textContent.trim().replace(/,/g, '').match(/^(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > 0) { log('DOM 链接文字读取 friends_count', n); return n; }
      }
    }
    return 0;
  }

  // 获取当前登录用户信息（始终拉取完整 profile，确保 friends_count 正确）
  async function fetchCurrentUserInfo() {
    let screenName = detectCurrentScreenName();

    // 页面检测失败，用 settings 接口兜底
    if (!screenName) {
      try {
        const data = await fetchRest('account/settings.json');
        if (data.screen_name) screenName = data.screen_name;
      } catch (e) {
        log('settings.json 获取失败', e.message);
      }
    }

    // 最终兜底：手动输入
    if (!screenName) {
      const input = prompt('未能自动识别用户名，请输入你的 X Handle（如 GANGDANwangw，无需@）:');
      if (input) screenName = input.trim().replace(/^@/, '');
    }

    if (!screenName) throw new Error('未能识别当前登录账号');

    // 先从页面 DOM 读取 friends_count（最直接，不依赖任何接口）
    const domFriendsCount = getFriendsCountFromDOM();
    log('DOM friends_count', domFriendsCount);

    // 通过 UserByScreenName 拿 userId（friends_count 已知 API 返回 0，用 DOM 补充）
    try {
      const gql = await fetchGraphQL(USER_BY_SCREEN_NAME_QUERY_ID, 'UserByScreenName', {
        screen_name: screenName,
        withSafetyModeUserFields: true
      });
      const result = gql?.data?.user?.result;
      const normalized = normalizeUser(result);
      if (normalized) {
        // friends_count 优先用 DOM 值（API 返回 0 是 X 的限制）
        const fc = domFriendsCount > 0 ? domFriendsCount :
                   normalized.followingCount;
        log('UserByScreenName 成功，最终 friends_count', fc);
        return { ...normalized, followingCount: fc, friendsCount: fc };
      }
    } catch (e) {
      log('UserByScreenName 失败', e.message);
    }

    // 最终兜底：cookie userId + DOM friends_count
    const userId = getUserIdFromCookie();
    const fc = domFriendsCount > 0 ? domFriendsCount : (() => {
      const n = parseInt(prompt('无法自动获取关注数，请手动输入正在关注的人数：') || '0', 10);
      return isNaN(n) ? 0 : n;
    })();
    return {
      id: userId || 'unknown',
      name: screenName,
      handle: screenName,
      avatar: '',
      friendsCount: fc,
      followersCount: 0
    };
  }


  /**
   * 方案一：用 REST 1.1 followers/ids.json 拉取所有粉丝 ID（速度快，每页5000个）
   * 这是最稳定的粉丝数据来源
   */
  async function fetchAllFollowerIds(userId, onProgress) {
    const idSet = new Set();
    let cursor = -1;

    while (!state.shouldCancel) {
      onProgress({ status: `正在拉取粉丝 ID 列表 (已获取 ${idSet.size} 个)...` });

      let data;
      try {
        data = await fetchRest('followers/ids.json', {
          user_id: userId,
          stringify_ids: 'true',
          count: 5000,
          cursor: String(cursor)
        });
      } catch (err) {
        if (err.message === 'RATE_LIMITED_429') {
          onProgress({ status: '⚠️ 遇到限速，等待 35 秒后重试...' });
          await sleep(35000);
          continue;
        }
        throw err;
      }

      const ids = data.ids || [];
      ids.forEach(id => idSet.add(String(id)));
      log(`粉丝 IDs: 本次获取 ${ids.length}，累计 ${idSet.size}`);

      const nextCursor = data.next_cursor_str;
      if (!nextCursor || nextCursor === '0' || ids.length === 0) break;

      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS);
    }

    return idSet;
  }

  /**
   * 方案二（备选）：如果 followers/ids.json 失败，使用 friends/ids.json 验证逻辑
   * 实际上用 GraphQL Following 接口获取完整用户信息（头像、简介等）
   */
  async function fetchAllFollowingWithGraphQL(userId, maxCount, onProgress) {
    const list = [];
    let cursor = null;
    let page = 0;

    while (!state.shouldCancel) {
      page++;

      // 人数守卫：已拉取数量超过预期上限，立即停止（避免 userId 错误拉别人数据）
      if (list.length >= maxCount + 10) {
        log(`⚠️ 已拉取 ${list.length} 人超过预期 ${maxCount} 人上限，强制停止`);
        break;
      }
      const variables = {
        userId: String(userId),
        count: DEFAULT_PAGE_SIZE,
        includePromotedContent: false
      };
      if (cursor) variables.cursor = cursor;

      onProgress({ page, count: list.length, status: `正在拉取关注列表: 第 ${page} 页 (已获取 ${list.length} 人)...` });

      let data;
      try {
        data = await fetchGraphQL(FOLLOWING_QUERY_ID, 'Following', variables);
      } catch (err) {
        if (err.message === 'RATE_LIMITED_429') {
          onProgress({ status: '⚠️ 遇到限速，等待 35 秒后重试...' });
          await sleep(35000);
          continue;
        }
        throw err;
      }

      // 尝试多层路径解析
      let instructions = [];
      try {
        instructions =
          data?.data?.user?.result?.timeline?.timeline?.instructions ||
          data?.data?.user?.result?.timeline?.instructions ||
          [];
      } catch (e) {
        log('解析 instructions 出错', e);
      }

      let entries = [];
      for (const inst of instructions) {
        if (inst.type === 'TimelineAddEntries') {
          entries = inst.entries || [];
          break;
        }
      }

      // 如果 TimelineAddEntries 没找到，尝试直接拿所有 entries
      if (entries.length === 0) {
        for (const inst of instructions) {
          if (inst.entries) {
            entries = inst.entries;
            break;
          }
        }
      }

      let nextCursor = null;
      let newUsersCount = 0;

      for (const entry of entries) {
        const entryId = entry.entryId || '';

        // 用户条目
        if (entryId.startsWith('user-')) {
          const userResult = entry?.content?.itemContent?.user_results?.result;
          if (userResult) {
            const user = normalizeUser(userResult);
            if (user) {
              list.push(user);
              newUsersCount++;
            }
          }
        }

        // 游标（只匹配 cursor-bottom-，避免误匹配其他条目）
        if (entryId.startsWith('cursor-bottom-')) {
          const val = entry?.content?.value;
          if (val) nextCursor = val;
        }
      }

      log(`Following 第 ${page} 页: 新增 ${newUsersCount} 人，累计 ${list.length}`);

      if (!nextCursor || nextCursor === cursor || newUsersCount === 0) break;
      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    }

    return list;
  }

  /**
   * 备选：如果 GraphQL Following 也出问题，用 REST 1.1 friends/list.json
   * 每次最多返回 200 个，包含完整用户信息
   */
  async function fetchAllFollowingWithRest(userId, onProgress) {
    const list = [];
    let cursor = -1;
    let page = 0;

    while (!state.shouldCancel) {
      page++;
      onProgress({ page, count: list.length, status: `正在拉取关注列表 (REST): 第 ${page} 页 (已获取 ${list.length} 人)...` });

      let data;
      try {
        data = await fetchRest('friends/list.json', {
          user_id: userId,
          count: 200,
          skip_status: true,
          include_user_entities: false,
          cursor: String(cursor)
        });
      } catch (err) {
        if (err.message === 'RATE_LIMITED_429') {
          onProgress({ status: '⚠️ 遇到限速，等待 35 秒后重试...' });
          await sleep(35000);
          continue;
        }
        throw err;
      }

      const users = data.users || [];
      for (const u of users) {
        const user = normalizeUser(u);
        if (user) list.push(user);
      }

      log(`friends/list 第 ${page} 页: 新增 ${users.length} 人，累计 ${list.length}`);

      const nextCursor = data.next_cursor_str;
      if (!nextCursor || nextCursor === '0' || users.length === 0) break;

      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    }

    return list;
  }

  // 获取粉丝的完整资料，用于展示“粉丝待回关”列表。
  async function fetchAllFollowersWithRest(userId, onProgress) {
    const list = [];
    const seen = new Set();
    let cursor = -1;
    let page = 0;

    while (!state.shouldCancel) {
      page++;
      onProgress({ page, count: list.length, status: `正在拉取粉丝详情: 第 ${page} 页 (已获取 ${list.length} 人)...` });

      let data;
      try {
        data = await fetchRest('followers/list.json', {
          user_id: userId,
          count: 200,
          skip_status: true,
          include_user_entities: false,
          cursor: String(cursor)
        });
      } catch (err) {
        if (err.message === 'RATE_LIMITED_429') {
          onProgress({ status: '⚠️ 遇到限速，等待 35 秒后重试...' });
          await sleep(35000);
          continue;
        }
        throw err;
      }

      const users = data.users || [];
      for (const u of users) {
        const user = normalizeUser(u);
        if (!user || seen.has(user.id)) continue;
        const id = user.id;
        seen.add(id);
        list.push(user);
      }

      const nextCursor = data.next_cursor_str;
      if (!nextCursor || nextCursor === '0' || nextCursor === String(cursor) || users.length === 0) break;
      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    }

    return list;
  }

  async function unfollowUser(userId) {
    const csrfToken = getCsrfToken();
    const res = await fetch('https://x.com/i/api/1.1/friendships/destroy.json', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${BEARER_TOKEN}`,
        'x-csrf-token': csrfToken,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: `user_id=${userId}`,
      credentials: 'include'
    });
    return res.ok;
  }

  /* ==========================================================================
     5. UI 构建与渲染
     ========================================================================== */
  function injectStyles() {
    const css = `
      #x-mutual-ball {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: linear-gradient(135deg, #1d9bf0 0%, #0c7abf 100%);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        border-radius: 9999px;
        box-shadow: 0 4px 20px rgba(29, 155, 240, 0.4);
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
      }
      #x-mutual-ball:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 6px 24px rgba(29, 155, 240, 0.55);
      }
      #x-mutual-modal {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(4px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #e6edf3;
      }
      #x-mutual-panel {
        width: 100%;
        max-width: 820px;
        max-height: 90vh;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 20px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.8);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .xmc-btn-tab {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        border-radius: 8px;
        color: #8b949e;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .xmc-btn-tab.active-not-follow {
        background: rgba(244, 63, 94, 0.15);
        color: #fda4af;
        font-weight: 600;
        border: 1px solid rgba(244, 63, 94, 0.3);
      }
      .xmc-btn-tab.active-mutual {
        background: rgba(16, 185, 129, 0.15);
        color: #6ee7b7;
        font-weight: 600;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      .xmc-btn-tab.active-fans {
        background: rgba(56, 189, 248, 0.15);
        color: #7dd3fc;
        font-weight: 600;
        border: 1px solid rgba(56, 189, 248, 0.3);
      }
      .xmc-user-row {
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        transition: all 0.15s;
      }
      .xmc-user-row:hover {
        background: #131922;
        border-color: #388bfd;
      }
      #xmc-debug-bar {
        font-size: 11px;
        color: #8b949e;
        padding: 6px 20px;
        background: #0d1117;
        border-top: 1px solid #30363d;
        display: none;
        word-break: break-all;
      }
    `;
    const styleEl = document.createElement('style');
    styleEl.innerHTML = css;
    document.head.appendChild(styleEl);
  }

  function createUI() {
    injectStyles();

    const ball = document.createElement('div');
    ball.id = 'x-mutual-ball';
    ball.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      <span>互关筛查 v${state.version}</span>
    `;
    document.body.appendChild(ball);

    const modal = document.createElement('div');
    modal.id = 'x-mutual-modal';
    modal.innerHTML = `
      <div id="x-mutual-panel">
        <div style="padding: 18px 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #1d9bf0; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white;">𝕏</div>
            <div>
              <div style="font-size: 15px; font-weight: 700; color: #ffffff;">X 互关筛查助手 <span style="font-size: 11px; padding: 2px 6px; background: rgba(16,185,129,0.2); color: #34d399; border-radius: 4px;">v${state.version}</span></div>
              <div style="font-size: 11px; color: #8b949e;" id="xmc-user-info">准备就绪 · 纯本地运行</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="xmc-export-btn" style="padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 8px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; cursor: pointer;">📥 导出 CSV</button>
            <button id="xmc-scan-btn" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 8px; background: #1d9bf0; color: #ffffff; border: none; cursor: pointer;">🚀 开始扫描</button>
            <button id="xmc-close-btn" style="padding: 6px 10px; font-size: 14px; background: transparent; color: #8b949e; border: none; cursor: pointer;">✕</button>
          </div>
        </div>

        <div style="padding: 14px 20px; background: #0d1117; border-bottom: 1px solid #30363d; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
          <div style="padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 10px;">
            <div style="font-size: 11px; color: #8b949e;">关注总人数 (Following)</div>
            <div style="font-size: 18px; font-weight: 700; color: #ffffff;" id="xmc-count-following">0</div>
          </div>
          <div style="padding: 10px; background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 10px;">
            <div style="font-size: 11px; color: #f43f5e; font-weight: 600;">🔴 未回关我 (单向关注)</div>
            <div style="font-size: 18px; font-weight: 700; color: #fb7185;" id="xmc-count-not-follow">0</div>
          </div>
          <div style="padding: 10px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px;">
            <div style="font-size: 11px; color: #10b981; font-weight: 600;">🟢 双向互相关注</div>
            <div style="font-size: 18px; font-weight: 700; color: #34d399;" id="xmc-count-mutual">0</div>
          </div>
          <div style="padding: 10px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px;">
            <div style="font-size: 11px; color: #38bdf8; font-weight: 600;">🔵 粉丝待回关</div>
            <div style="font-size: 18px; font-weight: 700; color: #7dd3fc;" id="xmc-count-fans-not-followed">0</div>
          </div>
        </div>

        <div id="xmc-progress-box" style="display: none; padding: 10px 20px; background: #1c2128; border-bottom: 1px solid #30363d;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: #8b949e; margin-bottom: 5px;">
            <span id="xmc-progress-text">正在初始化...</span>
            <span id="xmc-cancel-btn" style="color: #f85149; cursor: pointer;">终止扫描</span>
          </div>
          <div style="width: 100%; height: 6px; background: #30363d; border-radius: 3px; overflow: hidden;">
            <div id="xmc-progress-bar" style="width: 0%; height: 100%; background: #1d9bf0; transition: width 0.3s;"></div>
          </div>
        </div>

        <div style="padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #30363d; gap: 10px;">
          <div style="display: flex; gap: 6px;" id="xmc-tabs-container">
            <button class="xmc-btn-tab active-not-follow" data-tab="not-following-back">
              <span>🔴 未回关我</span>
              <span style="font-size: 10px; opacity: 0.8;" id="xmc-badge-not-follow">0</span>
            </button>
            <button class="xmc-btn-tab" data-tab="mutual">
              <span>🟢 互相关注</span>
              <span style="font-size: 10px; opacity: 0.8;" id="xmc-badge-mutual">0</span>
            </button>
            <button class="xmc-btn-tab" data-tab="fans-not-followed">
              <span>🔵 粉丝待回关</span>
              <span style="font-size: 10px; opacity: 0.8;" id="xmc-badge-fans-not-followed">0</span>
            </button>
          </div>
          <input type="text" id="xmc-search-input" placeholder="搜索昵称、@handle 或简介..." style="width: 220px; padding: 6px 12px; font-size: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; outline: none;">
        </div>

        <div id="xmc-list-container" style="flex: 1; overflow-y: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 8px; min-height: 280px; max-height: 480px;">
          <div style="text-align: center; color: #8b949e; font-size: 13px; margin: auto; padding: 40px 0;">
            点击右上角「🚀 开始扫描」按钮开始筛查
          </div>
        </div>

        <div id="xmc-debug-bar">调试信息将显示在此处</div>
      </div>
    `;
    document.body.appendChild(modal);

    ball.addEventListener('click', () => { modal.style.display = 'flex'; });
    document.getElementById('xmc-close-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    document.getElementById('xmc-scan-btn').addEventListener('click', startScan);
    document.getElementById('xmc-cancel-btn').addEventListener('click', () => { state.shouldCancel = true; });

    document.getElementById('xmc-tabs-container').addEventListener('click', (e) => {
      const btn = e.target.closest('.xmc-btn-tab');
      if (!btn) return;
      state.currentTab = btn.dataset.tab;
      document.querySelectorAll('.xmc-btn-tab').forEach(b => { b.className = 'xmc-btn-tab'; });
      if (state.currentTab === 'not-following-back') btn.className = 'xmc-btn-tab active-not-follow';
       if (state.currentTab === 'mutual') btn.className = 'xmc-btn-tab active-mutual';
       if (state.currentTab === 'fans-not-followed') btn.className = 'xmc-btn-tab active-fans';
      renderUserList();
    });

    document.getElementById('xmc-search-input').addEventListener('input', (e) => {
      state.searchKeyword = e.target.value.trim().toLowerCase();
      renderUserList();
    });

    document.getElementById('xmc-export-btn').addEventListener('click', exportCSV);
  }

  function updateCounters() {
    document.getElementById('xmc-count-following').textContent = state.followingList.length;
    document.getElementById('xmc-count-not-follow').textContent = state.notFollowingBackList.length;
    document.getElementById('xmc-count-mutual').textContent = state.mutualList.length;
    document.getElementById('xmc-count-fans-not-followed').textContent = state.fansNotFollowedList.length;
    document.getElementById('xmc-badge-not-follow').textContent = state.notFollowingBackList.length;
    document.getElementById('xmc-badge-mutual').textContent = state.mutualList.length;
    document.getElementById('xmc-badge-fans-not-followed').textContent = state.fansNotFollowedList.length;
  }

  function setDebug(msg) {
    const bar = document.getElementById('xmc-debug-bar');
    if (bar) {
      bar.style.display = 'block';
      bar.textContent = '🔍 ' + msg;
    }
  }

  function renderUserList() {
    const container = document.getElementById('xmc-list-container');
    const targetList = {
      'not-following-back': state.notFollowingBackList,
      'mutual': state.mutualList,
      'fans-not-followed': state.fansNotFollowedList,
    }[state.currentTab] || [];

    const filtered = targetList.filter(u => {
      if (!state.searchKeyword) return true;
      return (u.name && u.name.toLowerCase().includes(state.searchKeyword)) ||
             (u.handle && u.handle.toLowerCase().includes(state.searchKeyword)) ||
             (u.bio && u.bio.toLowerCase().includes(state.searchKeyword));
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: #8b949e; font-size: 13px; margin: auto; padding: 40px 0;">
          没有找到匹配的用户
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(u => {
      const isNotFollow = state.currentTab === 'not-following-back';
      const isFansNotFollowed = state.currentTab === 'fans-not-followed';
      const profileUrl = u.handle
        ? `https://x.com/${encodeURIComponent(u.handle)}`
        : `https://x.com/i/user/${encodeURIComponent(u.id)}`;
      const safeAvatar = escapeHtml(u.avatar || '');
      const safeHandle = escapeHtml(u.handle || '');
      return `
        <div class="xmc-user-row">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <img src="${safeAvatar}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid #30363d; flex-shrink: 0;" />
            <div style="min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <a href="${profileUrl}" target="_blank" style="color: #ffffff; font-weight: 600; font-size: 13px; text-decoration: none;">${escapeHtml(u.name || u.handle || `用户 ${u.id}`)}</a>
                ${u.handle ? `<span style="color: #8b949e; font-size: 12px;">@${safeHandle}</span>` : ''}
                ${isNotFollow
                  ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(244,63,94,0.2); color: #fda4af;">未回关你</span>'
                  : (isFansNotFollowed
                    ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(56,189,248,0.2); color: #7dd3fc;">粉丝待回关</span>'
                    : '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(16,185,129,0.2); color: #6ee7b7;">双向互关</span>')}
              </div>
              <div style="color: #8b949e; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 480px; margin-top: 2px;">
                ${escapeHtml(u.bio || '无简介')}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <a href="${profileUrl}" target="_blank" style="padding: 5px 10px; font-size: 11px; color: #8b949e; text-decoration: none; border-radius: 6px; border: 1px solid #30363d;">
              主页 ↗
            </a>
             ${isNotFollow ? `
              <button onclick="window.__xmc_unfollow('${u.id}', '${u.handle}')" style="padding: 5px 12px; font-size: 11px; font-weight: 600; color: #f43f5e; background: rgba(244,63,94,0.15); border: 1px solid rgba(244,63,94,0.3); border-radius: 6px; cursor: pointer;">
                取关
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.__xmc_unfollow = async function(userId, handle) {
    if (!confirm(`确定要取关 @${handle} 吗？`)) return;
    try {
      const ok = await unfollowUser(userId);
      if (ok) {
        state.notFollowingBackList = state.notFollowingBackList.filter(u => u.id !== userId);
        state.followingList = state.followingList.filter(u => u.id !== userId);
        updateCounters();
        renderUserList();
      } else {
        alert('取关失败，请稍后重试');
      }
    } catch (e) {
      alert('操作异常: ' + e.message);
    }
  };

  /* ==========================================================================
     6. 扫描主流程：双接口集合运算，精准可靠
     ========================================================================== */
  async function startScan() {
    if (state.isRunning) return;
    state.isRunning = true;
    state.shouldCancel = false;

    const scanBtn = document.getElementById('xmc-scan-btn');
    const progressBox = document.getElementById('xmc-progress-box');
    const progressText = document.getElementById('xmc-progress-text');
    const progressBar = document.getElementById('xmc-progress-bar');

    scanBtn.disabled = true;
    scanBtn.textContent = '扫描中...';
    progressBox.style.display = 'block';

    try {
      // Step 1: 获取账号信息
      progressText.textContent = '正在识别账号身份...';
      progressBar.style.width = '5%';

      const user = await fetchCurrentUserInfo();
      state.currentUser = user;
      document.getElementById('xmc-user-info').textContent = `@${user.handle} (ID: ${user.id})`;
      log('账号识别成功', user);

      if (!user.id || user.id === 'unknown') {
        throw new Error('无法获取账号数字 ID，请确认已登录 X');
      }

      const friendsCount = user.friendsCount || 0;
      // maxCount：关注数 + 20 安全余量；DOM 读不到时默认 5000 避免太小
      const maxCount = friendsCount > 0 ? friendsCount + 20 : 5000;
      setDebug(`账号：@${user.handle} | ID: ${user.id} | 关注数：${friendsCount > 0 ? friendsCount + ' 人' : '未知（上限 5000）'}`);


      // Step 2: 拉取粉丝 ID 集合（REST 1.1 followers/ids.json，最稳定）
      progressText.textContent = '正在拉取粉丝 ID 列表...';
      progressBar.style.width = '15%';

      let followerIdSet = new Set();
      try {
        followerIdSet = await fetchAllFollowerIds(user.id, (prog) => {
          progressText.textContent = prog.status;
        });
        setDebug(`粉丝 ID 总数: ${followerIdSet.size}`);
        log('粉丝 ID 集合获取完成', `共 ${followerIdSet.size} 个`);
      } catch (err) {
        log('followers/ids.json 失败，继续用关注列表兜底', err.message);
        setDebug(`粉丝 ID 获取失败: ${err.message}，将仅显示关注列表`);
      }

      if (state.shouldCancel) throw new Error('用户已手动终止');

      // Step 3: 拉取关注列表（GraphQL，含头像/简介详情）
      progressText.textContent = '正在拉取关注列表详情...';
      progressBar.style.width = '30%';

      let followingList = [];

      // 先尝试 GraphQL
      try {
        followingList = await fetchAllFollowingWithGraphQL(user.id, maxCount, (prog) => {
          progressText.textContent = prog.status;
          progressBar.style.width = `${Math.min(85, 30 + (prog.count || 0) / Math.max(maxCount, 1) * 55)}%`;
        });
        log('GraphQL Following 成功', `共 ${followingList.length} 人`);
      } catch (err) {
        log('GraphQL Following 失败，降级到 REST friends/list.json', err.message);
        setDebug(`GraphQL 失败: ${err.message}，切换到 REST 接口...`);

        // 降级到 REST 接口
        followingList = await fetchAllFollowingWithRest(user.id, (prog) => {
          progressText.textContent = prog.status;
          progressBar.style.width = `${Math.min(85, 30 + (prog.count || 0) / Math.max(maxCount, 1) * 55)}%`;
        });
        log('REST friends/list 成功', `共 ${followingList.length} 人`);
      }

      state.followingList = followingList;

      if (state.shouldCancel) throw new Error('用户已手动终止');

       // Step 4: 获取粉丝详情，并进行三类关系集合运算
       progressText.textContent = '正在拉取粉丝详情...';
       progressBar.style.width = '68%';
       const followersList = await fetchAllFollowersWithRest(user.id, (prog) => {
         progressText.textContent = prog.status;
         progressBar.style.width = `${Math.min(88, 68 + (prog.count || 0) / 100)}` + '%';
       });

       if (state.shouldCancel) throw new Error('用户已手动终止');

       progressText.textContent = '正在分析互关关系...';
       progressBar.style.width = '92%';

       const followingIdSet = new Set(followingList.map(u => String(u.id)));
       const verifiedFollowerIdSet = new Set(followersList.map(u => String(u.id)));
       const mutual = followingList.filter(u => verifiedFollowerIdSet.has(String(u.id)));
       const notFollowingBack = followingList.filter(u => !verifiedFollowerIdSet.has(String(u.id)));
       const fansNotFollowed = followersList.filter(u => !followingIdSet.has(String(u.id)));

       state.followersList = followersList;
       state.followingIdSet = followingIdSet;
       state.followerIdSet = verifiedFollowerIdSet;
       state.mutualList = mutual;
       state.notFollowingBackList = notFollowingBack;
       state.fansNotFollowedList = fansNotFollowed;

       setDebug(`关注: ${followingList.length} | 粉丝: ${followersList.length} | 互关: ${mutual.length} | 未回关: ${notFollowingBack.length} | 待回关: ${fansNotFollowed.length}`);

      updateCounters();
      renderUserList();

      progressBar.style.width = '100%';
       progressText.textContent = `✅ 扫描完成！关注 ${followingList.length} 人，粉丝 ${followersList.length} 人，未回关 ${notFollowingBack.length} 人`;

      setTimeout(() => { progressBox.style.display = 'none'; }, 4000);

    } catch (err) {
      log('扫描出错', err);
      alert('扫描出错: ' + err.message);
      progressText.textContent = '扫描中断: ' + err.message;
      setDebug('ERROR: ' + err.message);
    } finally {
      state.isRunning = false;
      scanBtn.disabled = false;
      scanBtn.textContent = '🚀 重新扫描';
    }
  }

  /* ==========================================================================
     7. 导出 CSV
     ========================================================================== */
  function exportCSV() {
    const list = {
      'not-following-back': state.notFollowingBackList,
      'mutual': state.mutualList,
      'fans-not-followed': state.fansNotFollowedList,
    }[state.currentTab] || [];
    const title = {
      'not-following-back': '未回关名单',
      'mutual': '互相关注名单',
      'fans-not-followed': '粉丝待回关名单',
    }[state.currentTab] || '关系名单';

    if (list.length === 0) {
      alert('当前列表暂无数据可导出');
      return;
    }

    let csv = '\uFEFFHandle,昵称,主页链接,粉丝数,简介\n';
    list.forEach(u => {
      const cleanBio = (u.bio || '').replace(/"/g, '""').replace(/\n/g, ' ');
      const profileUrl = u.handle ? `https://x.com/${encodeURIComponent(u.handle)}` : `https://x.com/i/user/${encodeURIComponent(u.id)}`;
      csv += `"${u.handle}","${u.name}","${profileUrl}",${u.followersCount},"${cleanBio}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `x_${title}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }

})();
