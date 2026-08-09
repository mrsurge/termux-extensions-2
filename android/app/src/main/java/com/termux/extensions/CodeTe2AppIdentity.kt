package com.termux.extensions

internal const val CODE_TE2_APP_ID = "code_te2"
internal const val LEGACY_CODE_TE2_APP_ID = "file_editor_cm6"

private val LEGACY_CODE_TE2_APP_PATH = Regex(
    """(/app/)file_editor_cm6(?=/?(?:[?#]|$))""",
)

internal fun canonicalizeCodeTe2AppPath(value: String): String =
    LEGACY_CODE_TE2_APP_PATH.replace(value) { match ->
        "${match.groupValues[1]}$CODE_TE2_APP_ID"
    }

internal fun containsLegacyCodeTe2AppPath(value: String?): Boolean =
    !value.isNullOrBlank() &&
        LEGACY_CODE_TE2_APP_PATH.containsMatchIn(value.replace("\\/", "/"))
