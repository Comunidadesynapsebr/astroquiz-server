# AstroQuiz 8.2 — R8 hardening
# Do not keep com.astroquiz.game.* globally: that defeats obfuscation.

-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep only the third-party SDK code that may depend on reflection.
# App classes remain eligible for shrinking/obfuscation.
-keep class com.startapp.** { *; }
-dontwarn com.startapp.**
-keep class com.truenet.** { *; }
-dontwarn com.truenet.**

# Kotlin metadata used by runtime/reflection.
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# Stronger application renaming.
-repackageclasses 'x'
-allowaccessmodification
-overloadaggressively
-useuniqueclassmembernames
-renamesourcefileattribute SourceFile

# Remove debug logging from Release where safe.
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
}
