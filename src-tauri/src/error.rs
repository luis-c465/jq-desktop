use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Serialize)]
pub enum AppError {
    FileNotFound(String),
    ParseError(String),
    JqCompileError(String),
    JqRuntimeError(String),
    Cancelled,
    FileTooLarge(u64),
    NoFileLoaded,
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FileNotFound(path) => write!(f, "File not found: {path}"),
            Self::ParseError(message) => write!(f, "Invalid JSON: {message}"),
            Self::JqCompileError(message) => write!(f, "jq syntax error: {message}"),
            Self::JqRuntimeError(message) => write!(f, "jq runtime error: {message}"),
            Self::Cancelled => write!(f, "Query cancelled"),
            Self::FileTooLarge(size) => {
                write!(
                    f,
                    "File is too large ({size} bytes). Maximum supported size is 4 GB."
                )
            }
            Self::NoFileLoaded => write!(f, "No file loaded. Open a JSON file first."),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::FileNotFound(error.to_string()),
            _ => Self::ParseError(error.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::ParseError(error.to_string())
    }
}
