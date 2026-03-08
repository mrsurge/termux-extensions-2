pluginManagement {
    repositories {
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
        maven {
            url = uri("https://maven.mozilla.org/maven2/")
        }
        maven {
            url = uri("https://storage.googleapis.com/download.flutter.io")
        }
    }
}

rootProject.name = "TermuxExtensions"
include(":app")

// Flutter module inclusion
apply(from = "fconsole_bridge/.android/include_flutter.groovy")
