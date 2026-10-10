import unittest
import os
import csv
from x_checker import export_to_csv

class TestMutualCheckerAlgorithm(unittest.TestCase):
    def setUp(self):
        self.following = [
            {"id": "1", "screen_name": "user_a", "name": "User A", "followers_count": 100, "friends_count": 50, "bio": "Bio A"},
            {"id": "2", "screen_name": "user_b", "name": "User B", "followers_count": 200, "friends_count": 80, "bio": "Bio B"},
            {"id": "3", "screen_name": "user_c", "name": "User C", "followers_count": 300, "friends_count": 90, "bio": "Bio C"},
        ]
        self.followers = [
            {"id": "2", "screen_name": "user_b", "name": "User B", "followers_count": 200, "friends_count": 80, "bio": "Bio B"},
            {"id": "4", "screen_name": "user_d", "name": "User D", "followers_count": 400, "friends_count": 10, "bio": "Bio D"},
        ]

    def test_set_difference(self):
        follower_map = {u["id"]: u for u in self.followers}
        following_map = {u["id"]: u for u in self.following}

        not_following_back = [u for u in self.following if u["id"] not in follower_map]
        mutual = [u for u in self.following if u["id"] in follower_map]
        fans_not_followed = [u for u in self.followers if u["id"] not in following_map]

        # 验证未回关：user_a (1) 和 user_c (3)
        self.assertEqual(len(not_following_back), 2)
        self.assertEqual({u["id"] for u in not_following_back}, {"1", "3"})

        # 验证互关：user_b (2)
        self.assertEqual(len(mutual), 1)
        self.assertEqual(mutual[0]["id"], "2")

        # 验证待回关粉丝：user_d (4)
        self.assertEqual(len(fans_not_followed), 1)
        self.assertEqual(fans_not_followed[0]["id"], "4")

    def test_csv_export(self):
        tmp_csv = "test_output.csv"
        export_to_csv(tmp_csv, self.following)
        self.assertTrue(os.path.exists(tmp_csv))

        with open(tmp_csv, "r", encoding="utf-8-sig") as f:
            reader = list(csv.reader(f))
            self.assertEqual(reader[0], ["Handle", "昵称", "主页链接", "粉丝数", "关注数", "个人简介"])
            self.assertEqual(len(reader), 4) # 表头 + 3 条记录

        os.remove(tmp_csv)

if __name__ == "__main__":
    unittest.main()
