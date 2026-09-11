use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Read,
    Write,
    Delete,
}

#[derive(Default)]
pub struct FakeKeyring {
    entries: HashMap<String, String>,
    failure: Option<Failure>,
}

impl FakeKeyring {
    pub fn set_failure(&mut self, failure: Option<Failure>) {
        self.failure = failure;
    }

    pub fn set(&mut self, reference: &str, value: &str) -> Result<(), Failure> {
        if self.failure == Some(Failure::Write) {
            return Err(Failure::Write);
        }
        self.entries.insert(reference.to_owned(), value.to_owned());
        Ok(())
    }

    pub fn get(&self, reference: &str) -> Result<Option<String>, Failure> {
        if self.failure == Some(Failure::Read) {
            return Err(Failure::Read);
        }
        Ok(self.entries.get(reference).cloned())
    }

    pub fn delete(&mut self, reference: &str) -> Result<(), Failure> {
        if self.failure == Some(Failure::Delete) {
            return Err(Failure::Delete);
        }
        self.entries.remove(reference);
        Ok(())
    }
}

pub struct TempPrefs {
    path: PathBuf,
}

impl TempPrefs {
    pub fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("linkdqueue-desktop-test-{}", std::process::id()));
        fs::create_dir_all(&path).expect("create isolated temporary preferences");
        Self { path }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

impl Drop for TempPrefs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub struct MockHttpServer {
    address: SocketAddr,
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl MockHttpServer {
    pub fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback fixture server");
        listener
            .set_nonblocking(true)
            .expect("configure nonblocking fixture server");
        let address = listener.local_addr().expect("read fixture server address");
        let (stop, stopped): (Sender<()>, Receiver<()>) = mpsc::channel();
        let thread = thread::spawn(move || loop {
            if stopped.try_recv().is_ok() {
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => respond(stream),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        });
        Self {
            address,
            stop,
            thread: Some(thread),
        }
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }
}

fn respond(mut stream: TcpStream) {
    let mut request = [0; 1024];
    let _ = stream.read(&mut request);
    let body = br#"{"theme":"auto","version":"fixture"}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);
}

impl Drop for MockHttpServer {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
