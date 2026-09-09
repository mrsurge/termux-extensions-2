from app.apps.code_te2.explorer.contracts.search_review import parse_content_edit_target


def test_exact_identity_preserves_zero_width_and_byte_ranges() -> None:
    for start, end in [(5, 11), (5, 5), (0, 375 * 1024)]:
        target: dict[str, object] = {
            "sourceSha256": "a" * 64, "startByte": start, "endByte": end,
        }
        assert parse_content_edit_target(target) == target


def test_display_or_malformed_identity_cannot_authorize_replacement() -> None:
    invalid: list[object] = [None, {}, {"line": 1, "column": 2}]
    for changes in [
        {"sourceSha256": "invalid"}, {"startByte": True},
        {"startByte": -1}, {"endByte": 1}, {"endByte": 1.5},
        {"endByte": 375 * 1024 + 1},
    ]:
        target: dict[str, object] = {
            "sourceSha256": "a" * 64, "startByte": 5, "endByte": 11,
        }
        target.update(changes)
        invalid.append(target)
    for value in invalid:
        assert parse_content_edit_target(value) is None
