"""Unit test for forge/cache/store.py — exercises put/get roundtrip + staleness.

Run with:
    python -m pytest forge/cache/test_store.py -v
or as a script:
    python forge/cache/test_store.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# Make forge.cache importable from this file
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cache import store  # noqa: E402


SAMPLE_XML = """<?xml version="1.0"?>
<framecad_import>
  <jobnum>HG999001</jobnum>
  <plan name="GF-TEST-70.075">
    <frame name="W1"/>
    <frame name="W2"/>
  </plan>
</framecad_import>
"""

SAMPLE_RFY = b"\x00\x01\x02\x03\x04" * 1000  # 5000 bytes of fake RFY


class CacheRoundtripTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="forge-cache-test-"))
        self.cache_root = self.tmp / "cache"
        self.cache_root.mkdir()
        self.xml_path = self.tmp / "test-input.xml"
        self.rfy_path = self.tmp / "test-input.rfy"
        self.xml_path.write_text(SAMPLE_XML, encoding="utf-8")
        self.rfy_path.write_bytes(SAMPLE_RFY)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_put_creates_layout(self):
        entry = store.cache_put(self.xml_path, self.rfy_path,
                                cache_root=self.cache_root)
        self.assertEqual(entry["jobnum"], "HG999001")
        self.assertEqual(entry["plan_name"], "GF-TEST-70.075")
        self.assertEqual(entry["rfy_size"], 5000)

        # Files on disk
        cached_rfy = self.cache_root / "HG999001" / "GF-TEST-70.075.rfy"
        cached_meta = self.cache_root / "HG999001" / "GF-TEST-70.075.meta.json"
        self.assertTrue(cached_rfy.exists())
        self.assertEqual(cached_rfy.stat().st_size, 5000)
        self.assertTrue(cached_meta.exists())

        # Bytes are bit-exact
        self.assertEqual(cached_rfy.read_bytes(), SAMPLE_RFY)

        # _index.json contains the entry
        idx = json.loads((self.cache_root / "_index.json").read_text(encoding="utf-8"))
        self.assertIn("HG999001__GF-TEST-70.075", idx["entries"])

    def test_get_after_put(self):
        store.cache_put(self.xml_path, self.rfy_path, cache_root=self.cache_root)
        result = store.cache_get(self.xml_path, cache_root=self.cache_root)
        self.assertIsNotNone(result)
        self.assertTrue(result["hit"])
        self.assertEqual(result["meta"]["jobnum"], "HG999001")
        # Bytes match
        self.assertEqual(Path(result["rfy_path"]).read_bytes(), SAMPLE_RFY)

    def test_get_miss_when_xml_edited(self):
        store.cache_put(self.xml_path, self.rfy_path, cache_root=self.cache_root)
        # Modify XML — should now miss because xml_sha256 changes
        self.xml_path.write_text(SAMPLE_XML + "<!-- edited -->\n", encoding="utf-8")
        result = store.cache_get(self.xml_path, cache_root=self.cache_root)
        self.assertIsNone(result)

    def test_get_miss_when_no_entry(self):
        # No put first — should miss cleanly
        result = store.cache_get(self.xml_path, cache_root=self.cache_root)
        self.assertIsNone(result)

    def test_explicit_jobnum_overrides_xml(self):
        # Even though XML says HG999001, explicit jobnum wins
        entry = store.cache_put(self.xml_path, self.rfy_path,
                                jobnum="HG888888",
                                plan_name="MyPlan",
                                cache_root=self.cache_root)
        self.assertEqual(entry["jobnum"], "HG888888")
        self.assertEqual(entry["plan_name"], "MyPlan")
        cached_rfy = self.cache_root / "HG888888" / "MyPlan.rfy"
        self.assertTrue(cached_rfy.exists())

    def test_index_accumulates_multiple_entries(self):
        store.cache_put(self.xml_path, self.rfy_path, cache_root=self.cache_root)
        # Add a second one with different ids
        xml2 = self.tmp / "another.xml"
        rfy2 = self.tmp / "another.rfy"
        xml2.write_text(SAMPLE_XML.replace("HG999001", "HG999002"), encoding="utf-8")
        rfy2.write_bytes(SAMPLE_RFY[::-1])  # different content
        store.cache_put(xml2, rfy2, cache_root=self.cache_root)
        idx = json.loads((self.cache_root / "_index.json").read_text(encoding="utf-8"))
        self.assertEqual(len(idx["entries"]), 2)
        self.assertIn("HG999001__GF-TEST-70.075", idx["entries"])
        self.assertIn("HG999002__GF-TEST-70.075", idx["entries"])

    def test_resolve_cache_root_honours_env(self):
        with tempfile.TemporaryDirectory() as td:
            os.environ["FORGE_CACHE_DIR"] = td
            try:
                self.assertEqual(str(store.resolve_cache_root()), str(Path(td).resolve()))
            finally:
                del os.environ["FORGE_CACHE_DIR"]


if __name__ == "__main__":
    unittest.main(verbosity=2)
