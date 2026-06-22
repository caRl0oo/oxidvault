// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! OS-level access control for `{vault}.audit.log` files (ISO 27001).

use std::path::Path;

use crate::error::VaultError;

/// Creates the audit log if missing and restricts access to the vault owner (and Administrators on Windows).
pub fn secure_audit_log_file(path: &Path) -> Result<(), VaultError> {
    ensure_audit_log_exists(path)?;

    #[cfg(windows)]
    set_windows_dacl(path)?;

    #[cfg(unix)]
    set_unix_mode(path)?;

    #[cfg(not(any(windows, unix)))]
    {
        return Err(VaultError::Other(
            "audit log OS-level protection is not supported on this platform".into(),
        ));
    }

    Ok(())
}

/// Verifies that the platform can enforce audit-log file permissions.
pub fn verify_platform_audit_security(path: &Path) -> Result<(), VaultError> {
    secure_audit_log_file(path)?;

    #[cfg(unix)]
    verify_unix_mode(path)?;

    #[cfg(windows)]
    verify_windows_dacl(path)?;

    Ok(())
}

fn ensure_audit_log_exists(path: &Path) -> Result<(), VaultError> {
    if path.is_file() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_unix_mode(path: &Path) -> Result<(), VaultError> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = std::fs::metadata(path)?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(unix)]
fn verify_unix_mode(path: &Path) -> Result<(), VaultError> {
    use std::os::unix::fs::PermissionsExt;

    let mode = std::fs::metadata(path)?.permissions().mode() & 0o777;
    if mode != 0o600 {
        return Err(VaultError::Other(format!(
            "audit log permissions must be 0o600 (owner read/write only), found 0o{mode:o}"
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn set_windows_dacl(path: &Path) -> Result<(), VaultError> {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::Authorization::{SetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        AddAccessAllowedAce, CreateWellKnownSid, GetLengthSid, GetTokenInformation, InitializeAcl,
        InitializeSecurityDescriptor, SetSecurityDescriptorDacl, TokenUser,
        WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACL, ACL_REVISION,
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, SECURITY_DESCRIPTOR,
        SECURITY_MAX_SID_SIZE, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_READ, FILE_GENERIC_WRITE};
    use windows_sys::Win32::System::SystemServices::SECURITY_DESCRIPTOR_REVISION;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut process_token: HANDLE = ptr::null_mut();
    let token_opened =
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut process_token) != 0 };
    if !token_opened {
        return Err(win32_error("OpenProcessToken"));
    }

    let token_result = (|| -> Result<(), VaultError> {
        let mut token_user_size = 0u32;
        unsafe {
            GetTokenInformation(
                process_token,
                TokenUser,
                ptr::null_mut(),
                0,
                &mut token_user_size,
            );
        }

        if token_user_size == 0 {
            return Err(win32_error("GetTokenInformation(size)"));
        }

        let mut token_user_buf = vec![0u8; token_user_size as usize];
        let token_info_ok = unsafe {
            GetTokenInformation(
                process_token,
                TokenUser,
                token_user_buf.as_mut_ptr().cast(),
                token_user_size,
                &mut token_user_size,
            ) != 0
        };
        if !token_info_ok {
            return Err(win32_error("GetTokenInformation"));
        }

        let token_user = unsafe { &*(token_user_buf.as_ptr().cast::<TOKEN_USER>()) };
        let user_sid = token_user.User.Sid;
        if user_sid.is_null() {
            return Err(VaultError::Other(
                "failed to resolve current Windows user SID for audit log ACL".into(),
            ));
        }

        let mut admin_sid_buf = [0u8; SECURITY_MAX_SID_SIZE as usize];
        let mut admin_sid_size = SECURITY_MAX_SID_SIZE;
        let admin_sid_ok = unsafe {
            CreateWellKnownSid(
                WinBuiltinAdministratorsSid,
                ptr::null_mut(),
                admin_sid_buf.as_mut_ptr().cast(),
                &mut admin_sid_size,
            ) != 0
        };
        if !admin_sid_ok {
            return Err(win32_error("CreateWellKnownSid(Administrators)"));
        }
        let admin_sid = admin_sid_buf.as_mut_ptr().cast::<c_void>();

        let user_sid_len = unsafe { GetLengthSid(user_sid) };
        let admin_sid_len = unsafe { GetLengthSid(admin_sid) };
        let ace_size = size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>();
        let acl_size =
            (size_of::<ACL>() + ace_size * 2 + user_sid_len as usize + admin_sid_len as usize)
                as u32;

        let mut acl_buf = vec![0u8; acl_size as usize];
        let acl = acl_buf.as_mut_ptr().cast::<ACL>();

        let access_mask = FILE_GENERIC_READ | FILE_GENERIC_WRITE;
        let acl_initialized = unsafe { InitializeAcl(acl, acl_size, ACL_REVISION) != 0 };
        if !acl_initialized {
            return Err(win32_error("InitializeAcl"));
        }

        let user_ace_ok =
            unsafe { AddAccessAllowedAce(acl, ACL_REVISION, access_mask, user_sid) != 0 };
        if !user_ace_ok {
            return Err(win32_error("AddAccessAllowedAce(current user)"));
        }

        let admin_ace_ok =
            unsafe { AddAccessAllowedAce(acl, ACL_REVISION, access_mask, admin_sid) != 0 };
        if !admin_ace_ok {
            return Err(win32_error("AddAccessAllowedAce(Administrators)"));
        }

        let mut security_descriptor: SECURITY_DESCRIPTOR = unsafe { zeroed() };
        let sd_initialized = unsafe {
            InitializeSecurityDescriptor(
                ptr::addr_of_mut!(security_descriptor).cast(),
                SECURITY_DESCRIPTOR_REVISION,
            ) != 0
        };
        if !sd_initialized {
            return Err(win32_error("InitializeSecurityDescriptor"));
        }

        let dacl_set = unsafe {
            SetSecurityDescriptorDacl(ptr::addr_of_mut!(security_descriptor).cast(), 1, acl, 0) != 0
        };
        if !dacl_set {
            return Err(win32_error("SetSecurityDescriptorDacl"));
        }

        let set_info_result = unsafe {
            SetNamedSecurityInfoW(
                wide_path.as_ptr().cast(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                acl,
                ptr::null_mut(),
            )
        };
        if set_info_result != 0 {
            return Err(VaultError::Other(format!(
                "SetNamedSecurityInfoW failed (Windows error {set_info_result})"
            )));
        }

        Ok(())
    })();

    unsafe {
        CloseHandle(process_token);
    }

    token_result
}

#[cfg(windows)]
fn verify_windows_dacl(path: &Path) -> Result<(), VaultError> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        CreateWellKnownSid, EqualSid, GetAce, WinBuiltinGuestsSid, WinWorldSid, ACL,
        DACL_SECURITY_INFORMATION, SECURITY_MAX_SID_SIZE,
    };
    use windows_sys::Win32::System::SystemServices::ACCESS_ALLOWED_ACE_TYPE;

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut dacl: *mut ACL = ptr::null_mut();
    let mut security_descriptor: *mut c_void = ptr::null_mut();
    let query_result = unsafe {
        GetNamedSecurityInfoW(
            wide_path.as_ptr().cast(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut security_descriptor,
        )
    };
    if query_result != 0 {
        return Err(VaultError::Other(format!(
            "GetNamedSecurityInfoW failed (Windows error {query_result})"
        )));
    }

    let verify_result = (|| -> Result<(), VaultError> {
        if dacl.is_null() {
            return Err(VaultError::Other(
                "audit log has no DACL — compliance integrity cannot be verified".into(),
            ));
        }

        let ace_count = unsafe { (*dacl).AceCount };
        if ace_count == 0 {
            return Err(VaultError::Other(
                "audit log DACL is empty — access must be limited to the current user and Administrators"
                    .into(),
            ));
        }

        let forbidden_sids = [WinWorldSid, WinBuiltinGuestsSid];
        let mut forbidden_sid_bufs = Vec::new();
        for sid_type in forbidden_sids {
            let mut sid_buf = [0u8; SECURITY_MAX_SID_SIZE as usize];
            let mut sid_size = SECURITY_MAX_SID_SIZE;
            let sid_ok = unsafe {
                CreateWellKnownSid(
                    sid_type,
                    ptr::null_mut(),
                    sid_buf.as_mut_ptr().cast(),
                    &mut sid_size,
                ) != 0
            };
            if !sid_ok {
                return Err(win32_error("CreateWellKnownSid(forbidden principal)"));
            }
            forbidden_sid_bufs.push(sid_buf);
        }

        for index in 0..ace_count as u32 {
            let mut ace: *mut c_void = ptr::null_mut();
            let ace_ok = unsafe { GetAce(dacl.cast(), index, &mut ace) != 0 };
            if !ace_ok {
                return Err(win32_error("GetAce"));
            }

            let ace_header = unsafe { &*(ace.cast::<windows_sys::Win32::Security::ACE_HEADER>()) };
            if ace_header.AceType != ACCESS_ALLOWED_ACE_TYPE as u8 {
                continue;
            }

            let sid_ptr = unsafe {
                ace.cast::<u8>()
                    .add(
                        size_of::<windows_sys::Win32::Security::ACCESS_ALLOWED_ACE>()
                            - size_of::<u32>(),
                    )
                    .cast::<c_void>()
            };

            for forbidden in &mut forbidden_sid_bufs {
                if unsafe { EqualSid(sid_ptr, forbidden.as_mut_ptr().cast()) != 0 } {
                    return Err(VaultError::Other(
                        "audit log ACL must not grant access to Everyone or Guests".into(),
                    ));
                }
            }
        }

        Ok(())
    })();

    if !security_descriptor.is_null() {
        unsafe {
            LocalFree(security_descriptor);
        }
    }

    verify_result
}

#[cfg(windows)]
fn win32_error(context: &str) -> VaultError {
    use windows_sys::Win32::Foundation::GetLastError;
    let code = unsafe { GetLastError() };
    VaultError::Other(format!("{context} failed (Windows error {code})"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn secure_audit_log_file_sets_restrictive_permissions() {
        let dir = tempdir().expect("tempdir");
        let log_path = dir.path().join("team.audit.log");

        secure_audit_log_file(&log_path).expect("secure audit log");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&log_path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        verify_platform_audit_security(&log_path).expect("verify permissions");
    }
}
