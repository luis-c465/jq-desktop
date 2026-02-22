use crate::error::AppError;
use jaq_core::{data, load, Compiler, Ctx, Vars};
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
        let filter = build_filter(query)?;
        let input_json = serde_json::to_vec(input)
            .map_err(|error| AppError::JqRuntimeError(error.to_string()))?;
        let input_value = jaq_json::read::parse_single(&input_json)
            .map_err(|error| AppError::JqRuntimeError(error.to_string()))?;
        let ctx = Ctx::<data::JustLut<jaq_json::Val>>::new(&filter.lut, Vars::new([]));

        filter
            .id
            .run((ctx, input_value))
            .map(|result| {
                let value = result
                    .map_err(|error| AppError::JqRuntimeError(format!("{error:?}")))?
                    .to_string();
                Ok(JqOutput {
                    value_type: infer_value_type(&value),
                    value,
                })
            })
            .collect()
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
        .map_err(|errors| AppError::JqCompileError(format_error_items(errors)))?;

    Compiler::default()
        .with_funs(jaq_std::funs().chain(jaq_json::funs()))
        .compile(modules)
        .map_err(|errors| AppError::JqCompileError(format_error_items(errors)))
}

fn format_error_items<T: core::fmt::Debug>(items: impl IntoIterator<Item = T>) -> String {
    items
        .into_iter()
        .map(|item| format!("{item:?}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn infer_value_type(value: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<Value>(value) {
        return match parsed {
            Value::Object(_) => "object",
            Value::Array(_) => "array",
            Value::String(_) => "string",
            Value::Number(_) => "number",
            Value::Bool(_) => "boolean",
            Value::Null => "null",
        }
        .to_string();
    }

    "string".to_string()
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
