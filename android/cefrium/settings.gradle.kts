// Standalone Gradle build for the TE2 Cefrium client.
//
// This cannot be a subproject of ../settings.gradle.kts alongside :app: Cefrium
// 0.8.0 requires AGP 9.4+ / Gradle 9.7.1+ / JDK 25, and Gradle resolves one
// version per plugin id for the whole build -- a subproject cannot request a
// different AGP version than the root project already put on the classpath
// (verified: "the plugin is already on the classpath with a different version
// (8.9.1)"). :app stays on AGP 8.9.1 / Gradle 8.11.1 / JDK 17 in ../ ; this
// module is built independently from here with its own wrapper.
pluginManagement {
    repositories {
        maven("https://codeberg.org/api/packages/cefrium/maven")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven("https://codeberg.org/api/packages/cefrium/maven")
        maven {
            url = uri("https://maven.mozilla.org/maven2/")
        }
    }
}

rootProject.name = "cefrium"
