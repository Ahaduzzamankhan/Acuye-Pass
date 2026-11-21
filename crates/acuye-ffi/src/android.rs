//! JNI entry points used by the React Native Android app.
//!
//! Every method takes the database path (React Native gets it from
//! `NativeModules.Acuye.dataDir`) and returns a JSON string. The unlocked vault
//! lives in this process only; `lock` drops the key.

use std::sync::{Mutex, OnceLock};

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::mobile::MobileVault;

fn session() -> &'static Mutex<Option<MobileVault>> {
    static SESSION: OnceLock<Mutex<Option<MobileVault>>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

fn to_java(env: &mut JNIEnv, value: String) -> jstring {
    env.new_string(value)
        .map(|string| string.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn read(env: &mut JNIEnv, value: &JString) -> String {
    env.get_string(value)
        .map(|string| string.into())
        .unwrap_or_default()
}

fn failure(message: &str) -> String {
    serde_json::json!({ "ok": false, "code": "internal", "message": message }).to_string()
}

/// Run `action` against the shared session, opening the database on first use.
fn with_vault(
    env: &mut JNIEnv,
    db_path: JString,
    action: impl FnOnce(&mut MobileVault) -> String,
) -> jstring {
    let path = read(env, &db_path);
    let mut guard = match session().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard.is_none() {
        match MobileVault::open(&path) {
            Ok(vault) => *guard = Some(vault),
            Err(error) => {
                let payload = serde_json::json!({
                    "ok": false,
                    "code": error.code(),
                    "message": error.to_string(),
                })
                .to_string();
                return to_java(env, payload);
            }
        }
    }
    match guard.as_mut() {
        Some(vault) => {
            let payload = action(vault);
            to_java(env, payload)
        }
        None => to_java(env, failure("the vault could not be opened")),
    }
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_status(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
) -> jstring {
    with_vault(&mut env, db_path, |vault| vault.status_json())
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_createAccount(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    username: JString,
    password: JString,
) -> jstring {
    let name = read(&mut env, &username);
    let secret = read(&mut env, &password);
    with_vault(&mut env, db_path, |vault| vault.create_json(&name, &secret))
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_unlock(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    vault_id: JString,
    username: JString,
    password: JString,
) -> jstring {
    let id = read(&mut env, &vault_id);
    let name = read(&mut env, &username);
    let secret = read(&mut env, &password);
    with_vault(&mut env, db_path, |vault| {
        let id = if id.is_empty() {
            None
        } else {
            Some(id.as_str())
        };
        vault.unlock_json(id, &name, &secret)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_lock(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let mut guard = match session().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let payload = match guard.as_mut() {
        Some(vault) => vault.lock_json(),
        None => serde_json::json!({ "ok": true, "unlocked": false }).to_string(),
    };
    to_java(&mut env, payload)
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_list(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    query: JString,
) -> jstring {
    let needle = read(&mut env, &query);
    with_vault(&mut env, db_path, |vault| vault.list_json(&needle))
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_item(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    id: JString,
) -> jstring {
    let id = read(&mut env, &id);
    with_vault(&mut env, db_path, |vault| vault.item_json(&id))
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_secret(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    id: JString,
    field: JString,
) -> jstring {
    let id = read(&mut env, &id);
    let field = read(&mut env, &field);
    with_vault(&mut env, db_path, |vault| vault.secret_json(&id, &field))
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_totp(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    id: JString,
) -> jstring {
    let id = read(&mut env, &id);
    with_vault(&mut env, db_path, |vault| vault.totp_json(&id))
}

#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_createLogin(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    title: JString,
    username: JString,
    password: JString,
    url: JString,
    notes: JString,
) -> jstring {
    let title = read(&mut env, &title);
    let username = read(&mut env, &username);
    let password = read(&mut env, &password);
    let url = read(&mut env, &url);
    let notes = read(&mut env, &notes);
    with_vault(&mut env, db_path, |vault| {
        vault.create_login_json(&title, &username, &password, &url, &notes)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_fluxenite_acuyepass_mobile_AcuyeNative_generate(
    mut env: JNIEnv,
    _class: JClass,
    options_json: JString,
) -> jstring {
    let options = read(&mut env, &options_json);
    let payload = crate::generate_password_json(&options);
    to_java(&mut env, payload)
}
