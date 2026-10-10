#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
X (Twitter) 互关筛查 CLI 小工具
零外部第三方重依赖，纯 Python 3 标准库打造。
功能：筛查「我关注了他，但他没有回关我」的单向关注者，并导出 CSV。
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import csv
from datetime import datetime

BEARER_TOKEN = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D"
    "1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)

GRAPHQL_IDS = {
    "Following": "qGZZDF3mp91q7X22s3HxpA",
    "Followers": "JNyQdTISpzCkj_1fqxDvFg",
    "UserByScreenName": "Gb-d6r0vxPOADdG62OEBpQ",
}

GRAPHQL_FEATURES = {
    "rweb_tipjar_consumption_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "rweb_video_timestamps_enabled": True,
    "longform_notetweets_basic_info_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}


class XMutualChecker:
    def __init__(self, auth_token: str, ct0: str):
        self.auth_token = auth_token.strip()
        self.ct0 = ct0.strip()
        self.headers = {
            "authorization": f"Bearer {BEARER_TOKEN}",
            "cookie": f"auth_token={self.auth_token}; ct0={self.ct0}",
            "x-csrf-token": self.ct0,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "user-agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        }

    def _http_get(self, url: str) -> dict:
        req = urllib.request.Request(url, headers=self.headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("\n⚠️ 触发 X API 限频 (429 Too Many Requests)，暂停等待 35 秒...")
                time.sleep(35)
                return self._http_get(url)
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP {e.code}: {err_body}")

    def verify_account(self) -> dict:
        url = "https://x.com/i/api/1.1/account/verify_credentials.json"
        data = self._http_get(url)
        return {
            "id": data.get("id_str"),
            "name": data.get("name"),
            "screen_name": data.get("screen_name"),
            "friends_count": data.get("friends_count"),
            "followers_count": data.get("followers_count"),
        }

    def fetch_users(self, list_type: str, user_id: str) -> list:
        users = []
        cursor = None
        query_id = GRAPHQL_IDS[list_type]
        page = 0

        while True:
            page += 1
            variables = {
                "userId": user_id,
                "count": 50,
                "includePromotedContent": False,
            }
            if cursor:
                variables["cursor"] = cursor

            url = (
                f"https://x.com/i/api/graphql/{query_id}/{list_type}?"
                f"variables={urllib.parse.quote(json.dumps(variables))}&"
                f"features={urllib.parse.quote(json.dumps(GRAPHQL_FEATURES))}"
            )

            data = self._http_get(url)

            instructions = (
                data.get("data", {})
                .get("user", {})
                .get("result", {})
                .get("timeline", {})
                .get("timeline", {})
                .get("instructions", [])
            )
            if not instructions:
                instructions = (
                    data.get("data", {})
                    .get("user", {})
                    .get("result", {})
                    .get("timeline", {})
                    .get("instructions", [])
                )

            entries = []
            for inst in instructions:
                if inst.get("type") == "TimelineAddEntries":
                    entries = inst.get("entries", [])
                    break

            next_cursor = None
            new_users = 0

            for entry in entries:
                entry_id = entry.get("entryId", "")
                if entry_id.startswith("user-"):
                    user_res = (
                        entry.get("content", {})
                        .get("itemContent", {})
                        .get("user_results", {})
                        .get("result", {})
                    )
                    legacy = user_res.get("legacy", {})
                    rest_id = user_res.get("rest_id") or legacy.get("id_str")
                    if rest_id:
                        users.append(
                            {
                                "id": rest_id,
                                "name": legacy.get("name", "Unknown"),
                                "screen_name": legacy.get("screen_name", ""),
                                "bio": legacy.get("description", ""),
                                "followers_count": legacy.get("followers_count", 0),
                                "friends_count": legacy.get("friends_count", 0),
                                "followed_by": legacy.get("followed_by") is True,
                            }
                        )
                        new_users += 1
                elif entry_id.startswith("cursor-bottom-"):
                    next_cursor = entry.get("content", {}).get("value")

            sys.stdout.write(
                f"\r  -> [{list_type}] 已拉取 {len(users)} 人 (第 {page} 页)..."
            )
            sys.stdout.flush()

            if not next_cursor or next_cursor == cursor or new_users == 0:
                break

            cursor = next_cursor
            time.sleep(1.0)  # 防风控平滑延时

        print(f"\n  ✅ {list_type} 拉取完毕，共 {len(users)} 人")
        return users


def export_to_csv(filepath: str, user_list: list):
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["Handle", "昵称", "主页链接", "粉丝数", "关注数", "个人简介"])
        for u in user_list:
            handle = u.get("screen_name", "")
            writer.writerow(
                [
                    f"@{handle}",
                    u.get("name", ""),
                    f"https://x.com/{handle}",
                    u.get("followers_count", 0),
                    u.get("friends_count", 0),
                    u.get("bio", "").replace("\n", " "),
                ]
            )


def main():
    print("=" * 60)
    print("  𝕏  X (Twitter) 互关筛查 CLI 助手")
    print("=" * 60)

    auth_token = os.environ.get("X_AUTH_TOKEN")
    ct0 = os.environ.get("X_CT0")

    if not auth_token or not ct0:
        print("\n💡 请提供浏览器 Cookie 中的凭证 (按 F12 -> Application -> Cookies):")
        if not auth_token:
            auth_token = input("请输入 auth_token: ").strip()
        if not ct0:
            ct0 = input("请输入 ct0: ").strip()

    if not auth_token or not ct0:
        print("❌ 错误：auth_token 与 ct0 不能为空！")
        sys.exit(1)

    checker = XMutualChecker(auth_token, ct0)

    print("\n🔍 正在校验账号身份...")
    try:
        user_info = checker.verify_account()
    except Exception as e:
        print(f"❌ 账号校验失败: {e}")
        print("请检查 auth_token 与 ct0 是否正确且有效。")
        sys.exit(1)

    print(f"✅ 成功识别账号: @{user_info['screen_name']} ({user_info['name']})")
    print(f"📊 关注数: {user_info['friends_count']} | 粉丝数: {user_info['followers_count']}\n")

    user_id = user_info["id"]

    # 1. 获取 Following 列表并直接提取互关状态
    print("🚀 正在拉取我关注的人 (Following)...")
    following = checker.fetch_users("Following", user_id)

    # 2. 核心比对计算
    mutual = [u for u in following if u.get("followed_by") is True]
    not_following_back = [u for u in following if u.get("followed_by") is not True]

    print("\n" + "=" * 60)
    print("📊 筛查结果汇总：")
    print(f"  • 我关注的总人数: {len(following)}")
    print(f"  • 🟢 双向互相关注: {len(mutual)}")
    print(f"  • 🔴 我关注但他未回关我: {len(not_following_back)}")
    print("=" * 60)

    # 导出文件
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = f"x_not_following_back_{date_str}.csv"
    export_to_csv(out_file, not_following_back)
    print(f"\n📁 未回关名单已成功导出至: {os.path.abspath(out_file)}")

    # 打印前 10 个未回关用户
    if not_following_back:
        print("\n👇 未回关用户预览 (前 10 名):")
        for i, u in enumerate(not_following_back[:10], 1):
            print(f"  {i:2d}. @{u['screen_name']:<18} {u['name']} (粉丝: {u['followers_count']})")


if __name__ == "__main__":
    main()
