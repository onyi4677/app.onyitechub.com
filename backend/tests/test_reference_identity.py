from app.services.reference_identity import duplicate_report, identity_keys, normalise_doi, normalise_text


def test_normalise_doi_accepts_url_and_prefix():
    assert normalise_doi(" https://doi.org/10.1234/ABC.1. ") == "10.1234/abc.1"


def test_identity_keys_keep_doi_and_metadata():
    record = {
        "doi": "10.1234/example",
        "title": "A Study of Displacement",
        "year": 2023,
        "authors": ["Smith, Jane"],
    }
    keys = identity_keys(record)
    assert "doi:10.1234/example" in keys
    assert "meta:a study of displacement|2023|smith jane" in keys


def test_duplicate_report_detects_doi_and_metadata_across_doi_formatting():
    records = [
        {"reference_id": "a", "doi": "10.1234/ABC", "title": "Paper", "year": 2022, "authors": ["Jones, A"]},
        {"reference_id": "b", "doi": "https://doi.org/10.1234/abc", "title": "Paper (full text)", "year": 2022, "authors": ["Jones, A"]},
    ]
    report = duplicate_report(records, "reference_id")
    assert report["duplicate_records"] == [
        {"reference_id": "b", "duplicate_of": "a", "match_type": "doi"}
    ]


def test_title_year_with_different_author_or_doi_is_review_candidate():
    records = [
        {"reference_id": "a", "doi": "10.1234/one", "title": "A Shared Title", "year": 2021, "authors": ["Smith, A"]},
        {"reference_id": "b", "doi": "10.1234/two", "title": "A Shared Title", "year": 2021, "authors": ["Jones, B"]},
    ]
    report = duplicate_report(records, "reference_id")
    assert report["duplicate_records"] == []
    assert len(report["possible_duplicate_groups"]) == 1


def test_normalise_text_handles_unicode_and_punctuation():
    assert normalise_text("A—B: ‘C’") == "a b c"
