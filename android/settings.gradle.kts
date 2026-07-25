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

rootProject.name = "TermuxExtensions"
include(":app")
include(":cefrium")
