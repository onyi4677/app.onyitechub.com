import hashlib
import io
import json
import unittest
import zipfile

from fastapi import HTTPException

from app.services.manuscript_backup_import import _read_and_validate_archive


def build_archive(*, corrupt_checksum=False, unsafe_path=False):
    files = {
        "project.json": json.dumps({"id": "source-project"}).encode(),
        "modules/research_foundation.json": json.dumps({"aim": "Map evidence"}).encode(),
        "study_screening.json": json.dumps({
            "records": [{"screening_id": "s1"}],
            "evidence_extractions": [],
            "source_verifications": [],
        }).encode(),
    }
    checksums = {
        name: hashlib.sha256(data).hexdigest()
        for name, data in files.items()
    }
    if corrupt_checksum:
        checksums["modules/research_foundation.json"] = "0" * 64
    manifest = {
        "backup_type": "read_only_project_module_backup",
        "source_project_id": "source-project",
        "file_sha256": checksums,
        "module_summary": {},
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("Project_001_Backup/manifest.json", json.dumps(manifest))
        for name, data in files.items():
            archive.writestr("Project_001_Backup/" + name, data)
        if unsafe_path:
            archive.writestr("Project_001_Backup/../escape.json", "{}")
    return output.getvalue()


class ManuscriptBackupImportArchiveTests(unittest.TestCase):
    def test_valid_archive_verifies_checksums_and_reads_modules(self):
        manifest, modules = _read_and_validate_archive(build_archive())
        self.assertEqual(manifest["source_project_id"], "source-project")
        self.assertEqual(set(modules), {"research_foundation", "study_screening"})
        self.assertEqual(modules["study_screening"]["records"][0]["screening_id"], "s1")

    def test_rejects_checksum_mismatch(self):
        with self.assertRaises(HTTPException) as context:
            _read_and_validate_archive(build_archive(corrupt_checksum=True))
        self.assertEqual(context.exception.status_code, 422)
        self.assertIn("Checksum verification failed", context.exception.detail)

    def test_rejects_unsafe_archive_paths(self):
        with self.assertRaises(HTTPException) as context:
            _read_and_validate_archive(build_archive(unsafe_path=True))
        self.assertEqual(context.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
