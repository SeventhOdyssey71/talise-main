# kotlinx.serialization — keep generated serializers.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class io.talise.app.core.model.** { *; }
-keep,includedescriptorclasses class io.talise.app.**$$serializer { *; }
-keepclassmembers class io.talise.app.** {
    *** Companion;
}
-keepclasseswithmembers class io.talise.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit / OkHttp
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-keep class org.bouncycastle.** { *; }
