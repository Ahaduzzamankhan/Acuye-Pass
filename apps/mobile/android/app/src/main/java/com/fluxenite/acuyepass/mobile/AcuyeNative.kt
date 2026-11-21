package com.fluxenite.acuyepass.mobile

/**
 * JNI surface implemented by the shared Rust core (`crates/acuye-ffi`).
 * Every call returns a JSON string; nothing is cached in Java.
 */
object AcuyeNative {
    init {
        System.loadLibrary("acuye_ffi")
    }

    /** One command from the JSON router in `crates/acuye-ffi/src/mobile.rs`. */
    external fun call(dbPath: String, op: String, argsJson: String): String
    external fun status(dbPath: String): String
    external fun createAccount(dbPath: String, username: String, password: String): String
    external fun unlock(dbPath: String, vaultId: String, username: String, password: String): String
    external fun lock(): String
    external fun list(dbPath: String, query: String): String
    external fun item(dbPath: String, id: String): String
    external fun secret(dbPath: String, id: String, field: String): String
    external fun totp(dbPath: String, id: String): String
    external fun createLogin(
        dbPath: String,
        title: String,
        username: String,
        password: String,
        url: String,
        notes: String,
    ): String
    external fun generate(optionsJson: String): String
}
