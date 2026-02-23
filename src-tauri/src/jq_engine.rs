use crate::error::AppError;
use jaq_core::{data, load, val, Compiler, Ctx, Vars};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct JqOutput {
    pub value: String,
    pub value_type: String,
}

pub struct JqEngine;

impl JqEngine {
    pub fn validate(query: &str) -> Result<(), AppError> {
        let _ = build_filter(query)?;
        Ok(())
    }

    pub fn execute(query: &str, input: &Value) -> Result<Vec<JqOutput>, AppError> {
        let mut outputs = Vec::new();
        Self::execute_stream(query, input, |output| {
            outputs.push(output);
            Ok(true)
        })?;
        Ok(outputs)
    }

    pub fn execute_stream<F>(query: &str, input: &Value, mut on_output: F) -> Result<(), AppError>
    where
        F: FnMut(JqOutput) -> Result<bool, AppError>,
    {
        let filter = build_filter(query)?;
        let input_value = to_jaq_value(input);
        let ctx = Ctx::<data::JustLut<jaq_json::Val>>::new(&filter.lut, Vars::new([]));

        for result in filter.id.run((ctx, input_value)) {
            let value = val::unwrap_valr(result)
                .map_err(|error| AppError::JqRuntimeError(error.to_string()))?;
            let output = JqOutput {
                value_type: infer_value_type(&value),
                value: value.to_string(),
            };

            if !on_output(output)? {
                break;
            }
        }

        Ok(())
    }
}

fn build_filter(query: &str) -> Result<jaq_core::Filter<data::JustLut<jaq_json::Val>>, AppError> {
    let program = load::File {
        code: query,
        path: (),
    };
    let arena = load::Arena::default();
    let loader = load::Loader::new(jaq_std::defs().chain(jaq_json::defs()));
    let modules = loader
        .load(&arena, program)
        .map_err(|errors| AppError::JqCompileError(format_load_errors(errors)))?;

    Compiler::default()
        .with_funs(jaq_std::funs().chain(jaq_json::funs()))
        .compile(modules)
        .map_err(|errors| AppError::JqCompileError(format_compile_errors(errors)))
}

fn format_load_errors(errors: jaq_core::load::Errors<&str, ()>) -> String {
    let mut messages = Vec::new();

    for (_file, error) in errors {
        match error {
            load::Error::Io(entries) => {
                for (path, message) in entries {
                    messages.push(format!("module import error for `{path}`: {message}"));
                }
            }
            load::Error::Lex(entries) => {
                for (expect, got) in entries {
                    let found = preview_fragment(got);
                    messages.push(format!("expected {}, found {found}", expect.as_str()));
                }
            }
            load::Error::Parse(entries) => {
                for (expect, found) in entries {
                    let token = preview_fragment(found);
                    messages.push(format!("expected {}, found {token}", expect.as_str()));
                }
            }
        }
    }

    if messages.is_empty() {
        "jq syntax error".to_string()
    } else {
        messages.join("; ")
    }
}

fn format_compile_errors(errors: jaq_core::compile::Errors<&str, ()>) -> String {
    let mut messages = Vec::new();

    for (_file, undefined_items) in errors {
        for (name, undefined) in undefined_items {
            messages.push(match undefined {
                jaq_core::compile::Undefined::Filter(arity) => {
                    format!("unknown filter `{name}/{arity}`")
                }
                _ => format!("unknown {} `{name}`", undefined.as_str()),
            });
        }
    }

    if messages.is_empty() {
        "jq syntax error".to_string()
    } else {
        messages.join("; ")
    }
}

fn preview_fragment(input: &str) -> String {
    if input.is_empty() {
        return "end of input".to_string();
    }

    format!("`{}`", preview_token(input))
}

fn preview_token(input: &str) -> String {
    const MAX_CHARS: usize = 24;

    let mut preview = String::new();
    for character in input.chars().take(MAX_CHARS) {
        match character {
            '\n' => preview.push_str("\\n"),
            '\r' => preview.push_str("\\r"),
            '\t' => preview.push_str("\\t"),
            _ => preview.push(character),
        }
    }

    if input.chars().count() > MAX_CHARS {
        preview.push_str("...");
    }

    preview
}

fn infer_value_type(value: &jaq_json::Val) -> String {
    match value {
        jaq_json::Val::Obj(_) => "object",
        jaq_json::Val::Arr(_) => "array",
        jaq_json::Val::Str(_, _) => "string",
        jaq_json::Val::Num(_) => "number",
        jaq_json::Val::Bool(_) => "boolean",
        jaq_json::Val::Null => "null",
    }
    .to_string()
}

fn to_jaq_value(value: &Value) -> jaq_json::Val {
    match value {
        Value::Null => jaq_json::Val::Null,
        Value::Bool(value) => jaq_json::Val::Bool(*value),
        Value::Number(value) => jaq_json::Val::Num(to_jaq_number(value)),
        Value::String(value) => jaq_json::Val::utf8_str(value.clone()),
        Value::Array(values) => {
            jaq_json::Val::Arr(jaq_json::Rc::new(values.iter().map(to_jaq_value).collect()))
        }
        Value::Object(values) => {
            let map = values
                .iter()
                .map(|(key, value)| (jaq_json::Val::utf8_str(key.clone()), to_jaq_value(value)))
                .collect();
            jaq_json::Val::obj(map)
        }
    }
}

fn to_jaq_number(number: &serde_json::Number) -> jaq_json::Num {
    if let Some(value) = number.as_i64() {
        return jaq_json::Num::from_integral(value);
    }

    if let Some(value) = number.as_u64() {
        return jaq_json::Num::from_integral(value);
    }

    if let Some(value) = number.as_f64() {
        return jaq_json::Num::Float(value);
    }

    jaq_json::Num::from_dec_str(&number.to_string())
}

#[cfg(test)]
mod tests {
    use super::JqEngine;
    use serde_json::json;

    #[test]
    fn executes_identity_query() {
        let outputs = JqEngine::execute(".", &json!({ "a": 1 })).expect("query should execute");

        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].value, "{\"a\":1}");
        assert_eq!(outputs[0].value_type, "object");
    }

    #[test]
    fn executes_keys_query() {
        let outputs =
            JqEngine::execute("keys", &json!({ "b": 1, "a": 2 })).expect("query should execute");

        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].value, "[\"a\",\"b\"]");
        assert_eq!(outputs[0].value_type, "array");
    }

    #[test]
    fn executes_select_query() {
        let outputs = JqEngine::execute(
            ".[] | select(.age > 30)",
            &json!([
                { "name": "alice", "age": 31 },
                { "name": "bob", "age": 22 },
                { "name": "carol", "age": 45 }
            ]),
        )
        .expect("query should execute");

        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].value_type, "object");
        assert_eq!(outputs[1].value_type, "object");
    }

    #[test]
    fn rejects_invalid_query() {
        let error = JqEngine::execute(".[[[", &json!({ "a": 1 })).expect_err("query should fail");
        assert!(error.to_string().contains("jq"));
    }

    #[test]
    fn validates_valid_query() {
        JqEngine::validate(".name").expect("query should validate");
    }
}
