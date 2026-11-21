package com.fluxenite.acuyepass.mobile

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

/**
 * The one native module the JavaScript side talks to.
 *
 * `AcuyeNative` is a plain JNI holder, not a React Native module, so it is
 * never visible through `NativeModules`. Everything the app needs — the private
 * data directory and every vault call — is exported here instead, and each call
 * resolves with the JSON string the Rust core produced. Nothing is decrypted in
 * Java or JavaScript.
 */
class AcuyeModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    override fun getName(): String = "Acuye"

    private fun answer(promise: Promise, block: () -> String) {
        try {
            promise.resolve(block())
        } catch (error: Throwable) {
            promise.reject("acuye_native", error.message ?: "The native vault failed", error)
        }
    }

    /** Private app files directory; the vault lives at `<dir>/acuye.db`. */
    @ReactMethod
    fun dataDir(promise: Promise) {
        promise.resolve(context.filesDir.absolutePath)
    }

    /**
     * Every vault command goes through the Rust router, so the app and the
     * desktop share one implementation of items, recovery, import and export.
     */
    @ReactMethod
    fun call(dbPath: String, op: String, argsJson: String, promise: Promise) =
        answer(promise) { AcuyeNative.call(dbPath, op, argsJson) }

    /** Open a login's website in the system browser. */
    @ReactMethod
    fun openUrl(url: String, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject("acuye_intent", error.message ?: "Could not open the link", error)
        }
    }

    @ReactMethod
    fun status(dbPath: String, promise: Promise) =
        answer(promise) { AcuyeNative.status(dbPath) }

    @ReactMethod
    fun createAccount(dbPath: String, username: String, password: String, promise: Promise) =
        answer(promise) { AcuyeNative.createAccount(dbPath, username, password) }

    @ReactMethod
    fun unlock(
        dbPath: String,
        vaultId: String,
        username: String,
        password: String,
        promise: Promise,
    ) = answer(promise) { AcuyeNative.unlock(dbPath, vaultId, username, password) }

    @ReactMethod
    fun lock(promise: Promise) = answer(promise) { AcuyeNative.lock() }

    @ReactMethod
    fun list(dbPath: String, query: String, promise: Promise) =
        answer(promise) { AcuyeNative.list(dbPath, query) }

    @ReactMethod
    fun item(dbPath: String, id: String, promise: Promise) =
        answer(promise) { AcuyeNative.item(dbPath, id) }

    @ReactMethod
    fun secret(dbPath: String, id: String, field: String, promise: Promise) =
        answer(promise) { AcuyeNative.secret(dbPath, id, field) }

    @ReactMethod
    fun totp(dbPath: String, id: String, promise: Promise) =
        answer(promise) { AcuyeNative.totp(dbPath, id) }

    @ReactMethod
    fun createLogin(
        dbPath: String,
        title: String,
        username: String,
        password: String,
        url: String,
        notes: String,
        promise: Promise,
    ) = answer(promise) { AcuyeNative.createLogin(dbPath, title, username, password, url, notes) }

    @ReactMethod
    fun generate(optionsJson: String, promise: Promise) =
        answer(promise) { AcuyeNative.generate(optionsJson) }
}

class AcuyePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(AcuyeModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
