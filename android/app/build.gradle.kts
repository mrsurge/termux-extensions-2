plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.termux.extensions"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.termux.extensions"
        minSdk = 24
        targetSdk = 34
        versionCode = 7
        versionName = "1.0.7"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.base"
    }

    flavorDimensions += "renderEngine"

    productFlavors {
        create("webview") {
            dimension = "renderEngine"
            applicationIdSuffix = ".webview"
            versionNameSuffix = "-webview"
            manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.webview"
        }
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

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        // Staging: non-debuggable (triggers Flutter release engine ~7MB)
        // but keeps minify off so Kotlin/Java stays readable in stack traces.
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.socket:socket.io-client:2.1.1")
    implementation(project(":flutter"))
    add("geckoImplementation", "org.mozilla.geckoview:geckoview:131.0.20240923135042")
    
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
