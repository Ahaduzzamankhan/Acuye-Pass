# Keep the JNI bridge: method names are resolved by Rust symbol names.
-keep class com.fluxenite.acuyepass.mobile.AcuyeNative { *; }
-keepclasseswithmembernames class * { native <methods>; }
