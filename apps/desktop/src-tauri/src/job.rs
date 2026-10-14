//! On Windows, the sidecar joins a Job Object that kills it when the shell's handle closes, so it
//! never outlives the shell, even if the shell is killed from Task Manager. Elsewhere this is a
//! no-op: the server shuts down when its stdin closes.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::io;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub struct ChildJob(HANDLE);

    // SAFETY: the handle is only passed to thread-safe Win32 calls and closed once, in Drop.
    unsafe impl Send for ChildJob {}
    // SAFETY: see above.
    unsafe impl Sync for ChildJob {}

    impl ChildJob {
        pub fn new() -> io::Result<Self> {
            // SAFETY: no security attributes and no name are valid arguments.
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(job);
            // SAFETY: all-zero is a valid value for this plain C struct.
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: `info` lives for the call and the size matches its type.
            let ok = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast::<c_void>(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }

        pub fn assign(&self, child: &tokio::process::Child) -> io::Result<()> {
            let Some(process) = child.raw_handle() else {
                // The child already exited.
                return Ok(());
            };
            // SAFETY: both handles are valid for the duration of the call. RawHandle and HANDLE are
            // the same pointer type, so no cast is needed.
            let ok = unsafe { AssignProcessToJobObject(self.0, process) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for ChildJob {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateJobObjectW and is closed only here.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;

    pub struct ChildJob;

    impl ChildJob {
        pub fn new() -> io::Result<Self> {
            Ok(Self)
        }

        pub fn assign(&self, _child: &tokio::process::Child) -> io::Result<()> {
            Ok(())
        }
    }
}

pub use imp::ChildJob;
