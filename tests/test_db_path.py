import unittest

from ktv.config import BASE_DIR
import ktv.core.db as db_module


class DatabasePathTests(unittest.TestCase):
    def test_database_file_lives_under_data_directory(self):
        self.assertEqual(db_module.DB_PATH, BASE_DIR / "data" / "ktv.db")


if __name__ == "__main__":
    unittest.main()
