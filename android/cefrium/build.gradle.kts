plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.cefrium") version "0.7.0"
}

android {
    namespace = "com.termux.extensions"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.termux.extensions.cefrium"
        minSdk = 29
        targetSdk = 34
        versionCode = 20329
        versionName = "1.0.7-r0.2.329-cefrium"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.cefrium"

        ndk {
            abiFilters += setOf("arm64-v8a")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "../app/proguard-rules.pro",
            )
        }
        create("staging") {
            isDebuggable = false
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }

    androidResources {
        noCompress += listOf("dat", "pak", "bin")
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
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

    sourceSets {
        getByName("main") {
            java.srcDir("../app/src/main/java")
            res.srcDir("../app/src/main/res")
            assets.srcDir("../app/src/main/assets")
        }
    }
}

configurations.all {
    exclude(group = "com.google.guava", module = "listenablefuture")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.02.01")

    implementation("com.cefrium:cefrium-sdk:0.7.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.mediarouter:mediarouter:1.7.0")
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
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
