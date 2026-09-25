plugins {
    id("com.android.application") version "9.4.0"
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10"
    id("com.cefrium") version "0.9.0"
}

android {
    namespace = "com.termux.extensions"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.termux.extensions.cefrium"
        minSdk = 29
        targetSdk = 34
        versionCode = 20351
        versionName = "1.0.8-r0.2.351-cefrium"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.cefrium"

        ndk {
            abiFilters += setOf("arm64-v8a")
        }
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("../signing/te2-development.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "../app/proguard-rules.pro",
                "proguard-rules.pro",
            )
        }
        create("staging") {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "../app/proguard-rules.pro",
                "proguard-rules.pro",
            )
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

    buildFeatures {
        compose = true
    }

    sourceSets {
        // AGP 9 does not infer shared Kotlin sources from java.srcDir.
        // Keep debug reflection and release stubs isolated in every variant.
        getByName("testDebug") {
            java.srcDir("../app/src/testDebug/java")
            kotlin.srcDir("../app/src/testDebug/java")
        }
        getByName("debug") {
            java.srcDir("../app/src/debug/java")
            kotlin.srcDir("../app/src/debug/java")
            manifest.srcFile("../app/src/debug/AndroidManifest.xml")
        }
        getByName("release") {
            java.srcDir("../app/src/nonDebug/java")
            kotlin.srcDir("../app/src/nonDebug/java")
        }
        getByName("staging") {
            java.srcDir("../app/src/nonDebug/java")
            kotlin.srcDir("../app/src/nonDebug/java")
        }
        getByName("main") {
            java.srcDir("../app/src/main/java")
            kotlin.srcDir("../app/src/main/java")
            res.srcDir("../app/src/main/res")
            assets.srcDir("../app/src/main/assets")
        }
    }
}

configurations.all {
    exclude(group = "com.google.guava", module = "listenablefuture")
}

dependencies {
    debugImplementation("org.jetbrains.kotlin:kotlin-reflect:2.2.10")
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")

    // Cefrium 0.9.0 publishes this as Maven `provided`, which Gradle does not
    // place on the consumer compile/R8 classpath. Keep the extracted classes
    // JAR until the upstream Gradle metadata supplies an equivalent dependency.
    compileOnly(files("libs/window-extensions-core-1.0.0.jar"))
    implementation("com.cefrium:cefrium-sdk:0.9.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.mediarouter:mediarouter:1.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.8.22")
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
    testImplementation("org.json:json:20090211")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
