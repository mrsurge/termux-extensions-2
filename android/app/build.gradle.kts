plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.termux.extensions"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.termux.extensions"
        minSdk = 24
        targetSdk = 34
        versionCode = 20333
        versionName = "1.0.7-r0.2.333"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.base"
    }

    flavorDimensions += "renderEngine"

    productFlavors {
        create("gecko") {
            dimension = "renderEngine"
            applicationIdSuffix = ".gecko"
            versionNameSuffix = "-gecko"
            manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.gecko"

            // GeckoView APKs are huge when built as universal APKs.
            // Restrict this flavor to arm64-v8a for now.
            ndk {
                abiFilters += setOf("arm64-v8a")
            }
        }
    }

    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("signing/te2-development.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        // Staging: non-debuggable but keeps minify off so Kotlin/Java
        // stays readable in stack traces.
        // Excludes Vulkan validation layer (222MB debug-only artifact).
        create("staging") {
            isDebuggable = false
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }

    packaging {
        jniLibs {
            // Vulkan validation layer — 222MB debug-only, causes GPU jank under load
            excludes += setOf("lib/*/libVkLayer_khronos_validation.so")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.02.01")

    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("io.socket:socket.io-client:2.1.1")
    implementation("org.msgpack:msgpack-core:0.9.12")
    add("geckoImplementation", "org.mozilla.geckoview:geckoview:144.0.20251027123126")
    debugImplementation("androidx.compose.ui:ui-tooling")
    
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
