import pytest

from release.termux.build_native_wheel import validate_release_source


def test_validation_is_never_publication_eligible():
    assert not validate_release_source(None, '0.2.352', 'a' * 40, '', None)


def test_clean_matching_release_tag_is_required():
    commit = 'a' * 40
    assert validate_release_source('0.2.352', '0.2.352', commit, '', commit)
    for tag, dirty, resolved in (
        ('other', '', commit), ('0.2.352', ' M setup.py', commit),
        ('0.2.352', '', 'b' * 40),
    ):
        with pytest.raises(ValueError):
            validate_release_source(tag, '0.2.352', commit, dirty, resolved)
