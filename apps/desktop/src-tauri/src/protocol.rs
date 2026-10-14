//! JSON-RPC 2.0 between the shell and the Node sidecar: one JSON message per line on the
//! sidecar's stdio. See docs/sidecar-protocol.md.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Notification, sidecar → shell: the server is listening.
pub const READY: &str = "ready";
/// Notification, sidecar → shell: the server can't start and must not be restarted.
pub const FATAL: &str = "fatal";
/// Request, shell → sidecar: a dashboard URL with a fresh one-time token.
pub const GET_DASHBOARD_URL: &str = "getDashboardUrl";
/// Request, shell → sidecar: shut down gracefully, then exit.
pub const SHUTDOWN: &str = "shutdown";

pub const METHOD_NOT_FOUND: i64 = -32601;

/// A message read from the sidecar's stdout.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Notification {
        method: String,
        params: Value,
    },
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Response {
        id: u64,
        outcome: Result<Value, RpcError>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReadyParams {
    pub port: u16,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FatalParams {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DashboardUrlResult {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(String);

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid sidecar message: {}", self.0)
    }
}

impl std::error::Error for ProtocolError {}

/// The fields of any JSON-RPC message. `result` keeps an explicit `null` apart from a missing field.
#[derive(Deserialize)]
struct RawMessage {
    jsonrpc: String,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

pub fn parse_line(line: &str) -> Result<Incoming, ProtocolError> {
    let raw: RawMessage =
        serde_json::from_str(line).map_err(|error| ProtocolError(error.to_string()))?;
    if raw.jsonrpc != "2.0" {
        return Err(ProtocolError(format!("jsonrpc is {:?}", raw.jsonrpc)));
    }
    let params = raw.params.unwrap_or(Value::Null);
    match (raw.method, raw.id) {
        (Some(method), Some(id)) => Ok(Incoming::Request { id, method, params }),
        (Some(method), None) => Ok(Incoming::Notification { method, params }),
        (None, Some(id)) => {
            let id = id
                .as_u64()
                .ok_or_else(|| ProtocolError(format!("unexpected response id {id}")))?;
            let outcome = match (raw.result, raw.error) {
                (Some(result), None) => Ok(result),
                (None, Some(error)) => Err(error),
                _ => return Err(ProtocolError("response needs result or error".into())),
            };
            Ok(Incoming::Response { id, outcome })
        }
        (None, None) => Err(ProtocolError("message has no method and no id".into())),
    }
}

#[derive(Serialize)]
struct OutgoingRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<&'a Value>,
}

#[derive(Serialize)]
struct OutgoingError<'a> {
    jsonrpc: &'static str,
    id: &'a Value,
    error: RpcError,
}

fn line(message: &impl Serialize) -> String {
    // Serializing these plain structs can't fail.
    let mut text = serde_json::to_string(message).unwrap_or_default();
    text.push('\n');
    text
}

/// One request line, ending with `\n`. `params` is left out when `None`.
pub fn encode_request(id: u64, method: &str, params: Option<&Value>) -> String {
    line(&OutgoingRequest {
        jsonrpc: "2.0",
        id,
        method,
        params,
    })
}

/// One error response line, ending with `\n`.
pub fn encode_error(id: &Value, code: i64, message: &str) -> String {
    line(&OutgoingError {
        jsonrpc: "2.0",
        id,
        error: RpcError {
            code,
            message: message.into(),
        },
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_ready_notification() {
        let message = parse_line(
            r#"{"jsonrpc":"2.0","method":"ready","params":{"port":6859,"version":"0.0.0"}}"#,
        )
        .unwrap();
        assert_eq!(
            message,
            Incoming::Notification {
                method: READY.into(),
                params: json!({ "port": 6859, "version": "0.0.0" }),
            }
        );
        let Incoming::Notification { params, .. } = message else {
            unreachable!()
        };
        let ready: ReadyParams = serde_json::from_value(params).unwrap();
        assert_eq!(ready.port, 6859);
    }

    #[test]
    fn parses_success_and_error_responses() {
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","id":1,"result":{"url":"http://x"}}"#).unwrap(),
            Incoming::Response {
                id: 1,
                outcome: Ok(json!({ "url": "http://x" })),
            }
        );
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","id":2,"result":null}"#).unwrap(),
            Incoming::Response {
                id: 2,
                outcome: Ok(Value::Null),
            }
        );
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32603,"message":"boom"}}"#)
                .unwrap(),
            Incoming::Response {
                id: 3,
                outcome: Err(RpcError {
                    code: -32603,
                    message: "boom".into(),
                }),
            }
        );
    }

    #[test]
    fn parses_server_requests() {
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","id":"a","method":"secrets.get","params":["k"]}"#)
                .unwrap(),
            Incoming::Request {
                id: json!("a"),
                method: "secrets.get".into(),
                params: json!(["k"]),
            }
        );
    }

    #[test]
    fn rejects_invalid_json_and_wrong_version() {
        assert!(parse_line("not json").is_err());
        assert!(parse_line(r#"{"jsonrpc":"1.0","method":"ready"}"#).is_err());
        assert!(parse_line(r#"{"method":"ready"}"#).is_err());
        assert!(parse_line(r#"{"jsonrpc":"2.0"}"#).is_err());
        assert!(parse_line(r#"{"jsonrpc":"2.0","id":1}"#).is_err());
    }

    #[test]
    fn encodes_requests_without_params() {
        assert_eq!(
            encode_request(1, SHUTDOWN, None),
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"shutdown\"}\n"
        );
        assert_eq!(
            encode_request(2, "x", Some(&json!({ "a": 1 }))),
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"x\",\"params\":{\"a\":1}}\n"
        );
    }

    #[test]
    fn encodes_errors() {
        assert_eq!(
            encode_error(&json!("a"), METHOD_NOT_FOUND, "Method not found: x"),
            "{\"jsonrpc\":\"2.0\",\"id\":\"a\",\"error\":{\"code\":-32601,\"message\":\"Method not found: x\"}}\n"
        );
    }
}
