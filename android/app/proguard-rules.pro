# SnakeYAML uses java.beans.* which isn't on Android
-dontwarn java.beans.BeanInfo
-dontwarn java.beans.FeatureDescriptor
-dontwarn java.beans.IntrospectionException
-dontwarn java.beans.Introspector
-dontwarn java.beans.PropertyDescriptor

# Keep OkHttp (used by EditorAssetManager)
-dontwarn okhttp3.**
-dontwarn okio.**

# msgpack-core selects the platform buffer implementation with Class.forName.
-keep class org.msgpack.core.buffer.MessageBufferU { *; }
-keep class org.msgpack.core.buffer.MessageBufferBE { *; }
-dontwarn sun.nio.ch.DirectBuffer
