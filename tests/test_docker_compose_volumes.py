import unittest
from pathlib import Path


class DockerComposeVolumeTests(unittest.TestCase):
    def test_runtime_state_uses_named_volumes_instead_of_host_binds(self):
        compose = Path("docker-compose.yml").read_text()

        self.assertIn("ktv-cache:/app/cache", compose)
        self.assertIn("ktv-data:/app/data", compose)
        self.assertNotIn("./cache:/app/cache", compose)
        self.assertNotIn("./data:/app/data", compose)


if __name__ == "__main__":
    unittest.main()
