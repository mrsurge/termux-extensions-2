# SnakeYAML uses java.beans.* which isn't on Android
-dontwarn java.beans.BeanInfo
-dontwarn java.beans.FeatureDescriptor
-dontwarn java.beans.IntrospectionException
-dontwarn java.beans.Introspector
-dontwarn java.beans.PropertyDescriptor

# Keep OkHttp (used by EditorAssetManager)
-dontwarn okhttp3.**
-dontwarn okio.**
