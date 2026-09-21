# Cefrium embeds Chromium classes for full-Chrome features whose resource-only
# dependencies are intentionally absent from the embeddable runtime.
-dontwarn org.chromium.chrome.**.R$*
-dontwarn org.chromium.components.**.R$*
-dontwarn org.chromium.webapk.**.R$*
-dontwarn org.chromium.third_party.**.R$*
-dontwarn org.chromium.ui.**.R$*
-dontwarn com.airbnb.lottie.R$*
-dontwarn com.airbnb.lottie.**.R$*
-dontwarn com.google.android.gms.**.R$*
-dontwarn com.google.android.material.R$*
-dontwarn com.google.android.material.**.R$*
-dontwarn com.google.ar.core.R$*
-dontwarn com.google.ar.core.**.R$*

# Optional platform/library hooks referenced by Chromium but unavailable in
# this Android/Cefrium packaging combination.
-dontwarn android.app.HandoffActivityData**
-dontwarn android.app.HandoffActivityParams**
-dontwarn android.webkit.WebViewDelegate
-dontwarn kotlinx.coroutines.guava.ListenableFutureKt
-dontwarn org.chromium.chrome.browser.ProductConfig
