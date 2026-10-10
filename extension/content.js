/**
 * X 互关筛查助手 (Chrome / Edge 扩展 Content Script) - v1.4.1
 * 双接口集合运算：followers/ids.json + GraphQL Following，精准可靠
 */
(function () {
  'use strict';

  const oldBall = document.getElementById('x-mutual-ball');
  if (oldBall) oldBall.remove();
  const oldModal = document.getElementById('x-mutual-modal');
  if (oldModal) oldModal.remove();

  const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
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

  const DEFAULT_PAGE_SIZE = 200;
  const REQUEST_DELAY_MS = 800;

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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  // Normalize both current GraphQL user shapes and legacy/REST users into one model.
  function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let user = raw;
    if (user.user && typeof user.user === 'object' &&
        (user.__typename === 'UserWithVisibilityResults' || user.type === 'UserWithVisibilityResults')) {
      user = user.user;
    }

    const legacy = user.legacy || {};
    const core = user.core || {};
    const avatar = user.avatar || {};
    const profileBio = user.profile_bio || {};
    const nonEmpty = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
    const idValue = [user.rest_id, core.rest_id, core.id_str, core.id, legacy.id_str, legacy.id, user.id_str, user.id]
      .find(value => typeof value === 'string' && value.trim() ||
        (typeof value === 'number' && Number.isSafeInteger(value)));
    if (idValue === undefined || idValue === null || String(idValue).trim() === '') return null;

    const id = String(idValue);
    const handle = nonEmpty(core.screen_name, legacy.screen_name, user.screen_name);
    const name = nonEmpty(core.name, legacy.name, user.name) || handle || `用户 ${id}`;
    return {
      id,
      name,
      handle,
      bio: nonEmpty(profileBio.description, legacy.description, user.description),
      avatar: nonEmpty(avatar.image_url, legacy.profile_image_url_https, user.profile_image_url_https, user.profile_image_url) ||
        'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
      followersCount: user.followers_count ?? legacy.followers_count ?? 0,
      followingCount: user.following_count ?? user.friends_count ?? legacy.friends_count ?? 0,
    };
  }

  function detectCurrentScreenName() {
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink?.getAttribute('href')) {
      const handle = profileLink.getAttribute('href').replace(/^\//, '').split('/')[0];
      if (handle && !['home', 'explore', 'notifications', 'messages', 'i', 'settings'].includes(handle)) {
        return handle;
      }
    }
    const accountBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountBtn) {
      const spans = Array.from(accountBtn.querySelectorAll('span'));
      for (const s of spans) {
        if (s.textContent.startsWith('@')) return s.textContent.slice(1).trim();
      }
    }
    return null;
  }

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

  async function fetchCurrentUserInfo() {
    let userId = getUserIdFromCookie();
    let screenName = detectCurrentScreenName();

    if (!screenName) {
      try {
        const data = await fetchRest('account/settings.json');
        if (data.screen_name) screenName = data.screen_name;
      } catch (e) {}
    }

    if (!screenName) {
      const input = prompt('未能自动识别用户名，请输入你的 X Handle（如 elonmusk，无需@）:');
      if (input) screenName = input.trim().replace(/^@/, '');
    }

    if (!screenName) throw new Error('未能识别当前登录账号');

    if (!userId || !/^\d+$/.test(userId)) {
      try {
        const gql = await fetchGraphQL(USER_BY_SCREEN_NAME_QUERY_ID, 'UserByScreenName', {
          screen_name: screenName,
          withSafetyModeUserFields: true
        });
        const result = gql?.data?.user?.result;
        const normalized = normalizeUser(result);
        if (normalized) {
          userId = normalized.id;
          return normalized;
        }
      } catch (e) {}

      try {
        const data = await fetchRest('users/show.json', { screen_name: screenName });
        const normalized = normalizeUser(data);
        if (normalized) return normalized;
      } catch (e) {}
    }

    return normalizeUser({ id: userId, core: { screen_name: screenName } });
  }

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

      const nextCursor = data.next_cursor_str;
      if (!nextCursor || nextCursor === '0' || ids.length === 0) break;
      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS);
    }

    return idSet;
  }

  async function fetchAllFollowingWithGraphQL(userId, onProgress) {
    const list = [];
    let cursor = null;
    let page = 0;

    while (!state.shouldCancel) {
      page++;
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

      let instructions = [];
      try {
        instructions =
          data?.data?.user?.result?.timeline?.timeline?.instructions ||
          data?.data?.user?.result?.timeline?.instructions ||
          [];
      } catch (e) {}

      let entries = [];
      for (const inst of instructions) {
        if (inst.type === 'TimelineAddEntries') {
          entries = inst.entries || [];
          break;
        }
      }
      if (entries.length === 0) {
        for (const inst of instructions) {
          if (inst.entries) { entries = inst.entries; break; }
        }
      }

      let nextCursor = null;
      let newUsersCount = 0;

      for (const entry of entries) {
        const entryId = entry.entryId || '';
        if (entryId.startsWith('user-')) {
          const userResult = entry?.content?.itemContent?.user_results?.result;
          if (userResult) {
            const normalized = normalizeUser(userResult);
            if (normalized) {
              list.push(normalized);
              newUsersCount++;
            }
          }
        }
        if (entryId.startsWith('cursor-bottom-') || entryId.includes('cursor')) {
          const val = entry?.content?.value;
          if (val) nextCursor = val;
        }
      }

      if (!nextCursor || nextCursor === cursor || newUsersCount === 0) break;
      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    }

    return list;
  }

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
        const normalized = normalizeUser(u);
        if (normalized) list.push(normalized);
      }

      const nextCursor = data.next_cursor_str;
      if (!nextCursor || nextCursor === '0' || users.length === 0) break;
      cursor = nextCursor;
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    }

    return list;
  }

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
        const normalized = normalizeUser(u);
        if (!normalized) continue;
        const id = normalized.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push(normalized);
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

  function injectStyles() {
    const css = `
      #x-mutual-ball {
        position: fixed; bottom: 24px; right: 24px; z-index: 99999;
        display: flex; align-items: center; gap: 8px; padding: 10px 16px;
        background: linear-gradient(135deg, #1d9bf0 0%, #0c7abf 100%);
        color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px; font-weight: 600; border-radius: 9999px;
        box-shadow: 0 4px 20px rgba(29,155,240,0.4); cursor: pointer;
        transition: all 0.2s ease; user-select: none;
      }
      #x-mutual-ball:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 6px 24px rgba(29,155,240,0.55); }
      #x-mutual-modal {
        position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,0.75);
        backdrop-filter: blur(4px); display: none; align-items: center;
        justify-content: center; padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e6edf3;
      }
      #x-mutual-panel {
        width: 100%; max-width: 820px; max-height: 90vh; background: #161b22;
        border: 1px solid #30363d; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.8);
        display: flex; flex-direction: column; overflow: hidden;
      }
      .xmc-btn-tab {
        padding: 6px 12px; font-size: 12px; font-weight: 500; border-radius: 8px;
        color: #8b949e; background: transparent; border: none; cursor: pointer;
        transition: all 0.15s; display: flex; align-items: center; gap: 6px;
      }
      .xmc-btn-tab.active-not-follow { background: rgba(244,63,94,0.15); color: #fda4af; font-weight: 600; border: 1px solid rgba(244,63,94,0.3); }
      .xmc-btn-tab.active-mutual { background: rgba(16,185,129,0.15); color: #6ee7b7; font-weight: 600; border: 1px solid rgba(16,185,129,0.3); }
      .xmc-btn-tab.active-fans { background: rgba(56,189,248,0.15); color: #7dd3fc; font-weight: 600; border: 1px solid rgba(56,189,248,0.3); }
      .xmc-user-row {
        background: #0d1117; border: 1px solid #30363d; border-radius: 12px;
        padding: 12px 14px; display: flex; align-items: center;
        justify-content: space-between; gap: 12px; transition: all 0.15s;
      }
      .xmc-user-row:hover { background: #131922; border-color: #388bfd; }
      #xmc-debug-bar { font-size: 11px; color: #8b949e; padding: 6px 20px; background: #0d1117; border-top: 1px solid #30363d; display: none; word-break: break-all; }
    `;
    const el = document.createElement('style');
    el.innerHTML = css;
    document.head.appendChild(el);
  }

  function createUI() {
    injectStyles();

    const ball = document.createElement('div');
    ball.id = 'x-mutual-ball';
    ball.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span>互关筛查 v${state.version}</span>`;
    document.body.appendChild(ball);

    const modal = document.createElement('div');
    modal.id = 'x-mutual-modal';
    modal.innerHTML = `
      <div id="x-mutual-panel">
        <div style="padding:18px 20px;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:50%;background:#1d9bf0;display:flex;align-items:center;justify-content:center;font-weight:bold;color:white;">𝕏</div>
            <div>
              <div style="font-size:15px;font-weight:700;color:#fff;">X 互关筛查助手 <span style="font-size:11px;padding:2px 6px;background:rgba(16,185,129,0.2);color:#34d399;border-radius:4px;">v${state.version}</span></div>
              <div style="font-size:11px;color:#8b949e;" id="xmc-user-info">准备就绪 · 纯本地运行</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="xmc-export-btn" style="padding:6px 12px;font-size:12px;font-weight:600;border-radius:8px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;cursor:pointer;">📥 导出 CSV</button>
            <button id="xmc-scan-btn" style="padding:6px 14px;font-size:12px;font-weight:600;border-radius:8px;background:#1d9bf0;color:#fff;border:none;cursor:pointer;">🚀 开始扫描</button>
            <button id="xmc-close-btn" style="padding:6px 10px;font-size:14px;background:transparent;color:#8b949e;border:none;cursor:pointer;">✕</button>
          </div>
        </div>
        <div style="padding:14px 20px;background:#0d1117;border-bottom:1px solid #30363d;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
          <div style="padding:10px;background:#161b22;border:1px solid #30363d;border-radius:10px;">
            <div style="font-size:11px;color:#8b949e;">关注总人数</div>
            <div style="font-size:18px;font-weight:700;color:#fff;" id="xmc-count-following">0</div>
          </div>
          <div style="padding:10px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.25);border-radius:10px;">
            <div style="font-size:11px;color:#f43f5e;font-weight:600;">🔴 未回关我</div>
            <div style="font-size:18px;font-weight:700;color:#fb7185;" id="xmc-count-not-follow">0</div>
          </div>
          <div style="padding:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:10px;">
            <div style="font-size:11px;color:#10b981;font-weight:600;">🟢 互相关注</div>
            <div style="font-size:18px;font-weight:700;color:#34d399;" id="xmc-count-mutual">0</div>
          </div>
          <div style="padding:10px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:10px;">
            <div style="font-size:11px;color:#38bdf8;font-weight:600;">🔵 粉丝待回关</div>
            <div style="font-size:18px;font-weight:700;color:#7dd3fc;" id="xmc-count-fans-not-followed">0</div>
          </div>
        </div>
        <div id="xmc-progress-box" style="display:none;padding:10px 20px;background:#1c2128;border-bottom:1px solid #30363d;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b949e;margin-bottom:5px;">
            <span id="xmc-progress-text">正在初始化...</span>
            <span id="xmc-cancel-btn" style="color:#f85149;cursor:pointer;">终止扫描</span>
          </div>
          <div style="width:100%;height:6px;background:#30363d;border-radius:3px;overflow:hidden;">
            <div id="xmc-progress-bar" style="width:0%;height:100%;background:#1d9bf0;transition:width 0.3s;"></div>
          </div>
        </div>
        <div style="padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #30363d;gap:10px;">
          <div style="display:flex;gap:6px;" id="xmc-tabs-container">
            <button class="xmc-btn-tab active-not-follow" data-tab="not-following-back">
              <span>🔴 未回关我</span><span style="font-size:10px;opacity:0.8;" id="xmc-badge-not-follow">0</span>
            </button>
            <button class="xmc-btn-tab" data-tab="mutual">
              <span>🟢 互相关注</span><span style="font-size:10px;opacity:0.8;" id="xmc-badge-mutual">0</span>
            </button>
            <button class="xmc-btn-tab" data-tab="fans-not-followed">
              <span>🔵 粉丝待回关</span><span style="font-size:10px;opacity:0.8;" id="xmc-badge-fans-not-followed">0</span>
            </button>
          </div>
          <input type="text" id="xmc-search-input" placeholder="搜索昵称、@handle 或简介..." style="width:220px;padding:6px 12px;font-size:12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#c9d1d9;outline:none;">
        </div>
        <div id="xmc-list-container" style="flex:1;overflow-y:auto;padding:14px 20px;display:flex;flex-direction:column;gap:8px;min-height:280px;max-height:480px;">
          <div style="text-align:center;color:#8b949e;font-size:13px;margin:auto;padding:40px 0;">点击右上角「🚀 开始扫描」按钮开始筛查</div>
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
    if (bar) { bar.style.display = 'block'; bar.textContent = '🔍 ' + msg; }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function userUrl(user) {
    return user.handle
      ? `https://x.com/${encodeURIComponent(user.handle)}`
      : `https://x.com/i/user/${encodeURIComponent(user.id)}`;
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
      container.innerHTML = '<div style="text-align:center;color:#8b949e;font-size:13px;margin:auto;padding:40px 0;">没有找到匹配的用户</div>';
      return;
    }

    container.innerHTML = filtered.map(u => {
      const isNotFollow = state.currentTab === 'not-following-back';
      const isFansNotFollowed = state.currentTab === 'fans-not-followed';
      return `
        <div class="xmc-user-row">
          <div style="display:flex;align-items:center;gap:12px;min-width:0;">
             <img src="${escapeHtml(u.avatar)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid #30363d;flex-shrink:0;"
              onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'" />
            <div style="min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                 <a href="${userUrl(u)}" target="_blank" rel="noopener noreferrer" style="color:#fff;font-weight:600;font-size:13px;text-decoration:none;">${escapeHtml(u.name)}</a>
                 ${u.handle ? `<span style="color:#8b949e;font-size:12px;">@${escapeHtml(u.handle)}</span>` : ''}
                ${isNotFollow
                  ? '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(244,63,94,0.2);color:#fda4af;">未回关你</span>'
                  : (isFansNotFollowed
                    ? '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.2);color:#7dd3fc;">粉丝待回关</span>'
                    : '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(16,185,129,0.2);color:#6ee7b7;">双向互关</span>')}
              </div>
              <div style="color:#8b949e;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:480px;margin-top:2px;">
                ${escapeHtml(u.bio || '无简介')}
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
             <a href="${userUrl(u)}" target="_blank" rel="noopener noreferrer" style="padding:5px 10px;font-size:11px;color:#8b949e;text-decoration:none;border-radius:6px;border:1px solid #30363d;">主页 ↗</a>
             ${isNotFollow ? `<button onclick="window.__xmc_unfollow('${encodeURIComponent(u.id)}','${encodeURIComponent(u.handle)}')" style="padding:5px 12px;font-size:11px;font-weight:600;color:#f43f5e;background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);border-radius:6px;cursor:pointer;">取关</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  window.__xmc_unfollow = async function(userId, handle) {
    userId = decodeURIComponent(userId);
    handle = decodeURIComponent(handle);
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
      progressText.textContent = '正在识别账号身份...';
      progressBar.style.width = '5%';

      const user = await fetchCurrentUserInfo();
      if (!user) throw new Error('无法获取账号用户资料，请确认已登录 X');
      state.currentUser = user;
      document.getElementById('xmc-user-info').textContent = `${user.handle ? '@' + user.handle : user.name} (ID: ${user.id})`;
      log('账号识别成功', user);

      if (!user.id || user.id === 'unknown') {
        throw new Error('无法获取账号数字 ID，请确认已登录 X');
      }

      // Step 2: 拉取粉丝 ID 集合
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
        log('followers/ids.json 失败', err.message);
        setDebug(`粉丝 ID 获取失败: ${err.message}`);
      }

      if (state.shouldCancel) throw new Error('用户已手动终止');

      // Step 3: 拉取关注列表
      progressText.textContent = '正在拉取关注列表...';
      progressBar.style.width = '30%';

      let followingList = [];
      try {
        followingList = await fetchAllFollowingWithGraphQL(user.id, (prog) => {
          progressText.textContent = prog.status;
          progressBar.style.width = `${Math.min(85, 30 + (prog.count || 0) * 1.5)}%`;
        });
        log('GraphQL Following 成功', `共 ${followingList.length} 人`);
      } catch (err) {
        log('GraphQL 失败，降级到 REST', err.message);
        setDebug(`GraphQL 失败: ${err.message}，切换 REST...`);
        followingList = await fetchAllFollowingWithRest(user.id, (prog) => {
          progressText.textContent = prog.status;
          progressBar.style.width = `${Math.min(85, 30 + (prog.count || 0) * 1.5)}%`;
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
        progressBar.style.width = `${Math.min(88, 68 + (prog.count || 0) / 100)}%`;
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
    if (list.length === 0) { alert('当前列表暂无数据可导出'); return; }
    let csv = '\uFEFFHandle,昵称,主页链接,粉丝数,简介\n';
    list.forEach(u => {
      const cleanBio = (u.bio || '').replace(/"/g, '""').replace(/\n/g, ' ');
      csv += `"${u.handle}","${u.name}","https://x.com/${u.handle}",${u.followersCount},"${cleanBio}"\n`;
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
