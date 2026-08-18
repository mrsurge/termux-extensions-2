package com.termux.extensions

import android.content.Context

enum class NativeToolsTab(val storageValue: String) {
    CONSOLE("console"),
    INSPECTOR("inspector"),
    PROCESSES("processes");

    companion object {
        fun fromStorage(value: String?): NativeToolsTab =
            entries.firstOrNull { it.storageValue == value } ?: CONSOLE
    }
}

data class AndroidToolsState(
    val overlayVisible: Boolean = false,
    val selectedTab: NativeToolsTab = NativeToolsTab.CONSOLE,
    val inspectorTargetId: String? = null,
)

/** Android-owned persistence for native Tools chrome, independent of TE2 state. */
class AndroidToolsStateStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun load(): AndroidToolsState = AndroidToolsState(
        overlayVisible = preferences.getBoolean(KEY_OVERLAY_VISIBLE, false),
        selectedTab = NativeToolsTab.fromStorage(
            preferences.getString(KEY_SELECTED_TAB, null),
        ),
        inspectorTargetId = preferences.getString(KEY_INSPECTOR_TARGET_ID, null),
    )

    fun save(state: AndroidToolsState) {
        preferences.edit().apply {
            putBoolean(KEY_OVERLAY_VISIBLE, state.overlayVisible)
            putString(KEY_SELECTED_TAB, state.selectedTab.storageValue)
            if (state.inspectorTargetId.isNullOrBlank()) {
                remove(KEY_INSPECTOR_TARGET_ID)
            } else {
                putString(KEY_INSPECTOR_TARGET_ID, state.inspectorTargetId)
            }
        }.apply()
    }

    companion object {
        private const val PREFERENCES_NAME = "android_tools_state"
        private const val KEY_OVERLAY_VISIBLE = "overlay_visible"
        private const val KEY_SELECTED_TAB = "selected_tab"
        private const val KEY_INSPECTOR_TARGET_ID = "inspector_target_id"
    }
}
