use std::path::Path;
use std::process::{Command, Output};

fn directory() -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = std::env::temp_dir().join(format!(
        "obscura-native-trace-{}-{unique}", std::process::id()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}

fn run(script: &str, trace: Option<&Path>, flags: Option<&str>) -> Output {
    // Keep the URL on one line so it is also a usable TSV source field.
    let source: String = script.lines().map(str::trim).collect();
    let url = format!("data:text/html,<script>{source}</script>");
    let mut command = Command::new(env!("CARGO_BIN_EXE_obscura"));
    for name in ["OBSCURA_TRACE_API_FILE", "OBSCURA_TRACE_OP_FILE", "OBSCURA_V8_FLAGS"] {
        command.env_remove(name);
    }
    if let Some(path) = trace {
        command.arg("--trace-api-file").arg(path);
    }
    if let Some(flags) = flags {
        command.arg("--v8-flags").arg(flags);
    }
    let output = command.args([
        "fetch", &url, "--wait", "0", "--timeout", "15", "--quiet",
        "--eval", "JSON.stringify(globalThis.traceResult)",
    ]).output().expect("run trace fixture");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    output
}

fn count(trace: &str, status: &str, owner: &str, key: &str, operation: &str) -> usize {
    trace.lines().filter(|line| {
        let fields: Vec<_> = line.split('\t').collect();
        fields.len() == 8 && fields[0] == status && fields[1] == owner
            && fields[2] == key && fields[6] == operation
    }).count()
}

#[test]
fn native_trace_counts_cold_and_hot_properties_without_replaying_page_code() {
    let directory = directory();
    let path = directory.join("property trace.tsv");
    let script = r#"
        (()=>{
          let gets=0, sets=0, coercions=0, traps=0;
          const object={traceValue:7,traceUndefined:undefined,
            get traceGetter(){gets++;return 11;},
            set traceSetter(value){sets=value;}};
          const bomMissing=window.traceMissingBOM;
          function read(value,key){return value.traceValue+value[key];}
          let sum=0;
          for(let i=0;i<2000;i++)sum+=read(object,'traceValue');
          const missing=object.traceMissing;
          const present=object.traceUndefined;
          let methodThrew=false;
          try{object.traceMissingMethod();}catch(error){methodThrew=error instanceof TypeError;}
          const getter=object.traceGetter;
          object.traceSetter=13;
          const key='traceAdded'; const assigned=(object[key]=17);
          const found='traceUndefined' in object;
          const absent='traceAbsent' in object;
          const array=[3,,9]; let elements=[];
          for(let i=0;i<4;i++)elements.push(array[i]);
          const mapped=array.map(value=>value+1);
          const proxy=new Proxy({}, {get(){traps++;return 19;}});
          const proxied=proxy.traceProxy;
          const converted=object[{toString(){coercions++;return 'traceValue';}}];
          const typed=new Uint8Array(1); const outOfBounds=typed[4];
          const symbol=Symbol('traceSymbol'); object[symbol]=23;
          const symbolic=object[symbol];
          object['trace\tline\nslash\\']=29;
          const escaped=object['trace\tline\nslash\\'];
          let threw=false;try{null.traceNull;}catch(error){threw=error instanceof TypeError;}
          const dom=document.createElement('div');dom.setAttribute('data-value','ok');
          const domValue=dom.getAttribute('data-value');
          globalThis.traceResult={sum,gets,sets,coercions,traps,getter,found,absent,methodThrew,assigned,
            elements,mapped,proxied,converted,symbolic,escaped,threw,domValue,
            missing:missing===undefined,present:present===undefined,
            outOfBounds:outOfBounds===undefined};
        })();
    "#;
    let baseline = run(script, None, None);
    for flags in [None, Some("--no-use-ic"), Some("--jitless")] {
        let traced = run(script, Some(&path), flags);
        assert_eq!(baseline.stdout, traced.stdout, "trace changed page results: {flags:?}");
        let trace = std::fs::read_to_string(&path).unwrap();
        assert_eq!(count(&trace, "HIT", "Object", "traceValue", "GET"), 4000);
        assert_eq!(count(&trace, "MISS", "Object", "traceMissing", "GET"), 1);
        assert_eq!(count(&trace, "MISS", "Object", "traceMissingMethod", "GET"), 1);
        assert_eq!(count(&trace, "MISS", "Window", "traceMissingBOM", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "traceUndefined", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "traceGetter", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "traceSetter", "SET"), 1);
        assert_eq!(count(&trace, "MISS", "Object", "traceAdded", "SET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "traceUndefined", "HAS"), 1);
        assert_eq!(count(&trace, "MISS", "Object", "traceAbsent", "HAS"), 1);
        assert_eq!(count(&trace, "HIT", "Array", "0", "GET"), 1);
        assert_eq!(count(&trace, "MISS", "Array", "1", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Array", "2", "GET"), 1);
        assert_eq!(count(&trace, "MISS", "Array", "3", "GET"), 1);
        assert_eq!(count(&trace, "MISS", "Uint8Array", "4", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "<symbol>", "GET"), 1);
        assert_eq!(count(&trace, "HIT", "Object", "trace\\tline\\nslash\\\\", "GET"), 1);
        assert!(trace.lines().any(|line| line.starts_with("UNKNOWN\t") && line.contains("\ttraceProxy\t")));
        assert!(trace.contains("\t<unresolved-key>\t"));
        assert!(trace.contains("\tcreateElement\t"));
        assert!(trace.contains("\tsetAttribute\t"));
        assert!(!trace.contains("\text:core"));
        assert!(!trace.contains("\t<obscura:bootstrap>\t"));
        assert!(trace.contains("\t<eval>\t"), "CLI evaluations must not be filtered out");
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn native_trace_retains_reads_after_forced_optimization() {
    let directory = directory();
    let path = directory.join("optimized.tsv");
    let script = r#"
        (()=>{
          function read(object){return object.traceOptimized;}
          const object={traceOptimized:7};
          %PrepareFunctionForOptimization(read);
          let total=0;
          for(let i=0;i<64;i++)total+=read(object);
          %OptimizeFunctionOnNextCall(read);
          total+=read(object);
          for(let i=0;i<100;i++)total+=read(object);
          globalThis.traceResult={total,optimized:(%GetOptimizationStatus(read)&16)!==0};
        })();
    "#;
    let flags = Some("--allow-natives-syntax --no-maglev");
    let baseline = run(script, None, flags);
    let traced = run(script, Some(&path), flags);
    assert_eq!(baseline.stdout, traced.stdout);
    assert!(String::from_utf8_lossy(&traced.stdout).contains("true"),
        "the test must actually optimize the function");
    let trace = std::fs::read_to_string(path).unwrap();
    assert_eq!(count(&trace, "HIT", "Object", "traceOptimized", "GET"), 165);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn retired_descriptor_trace_options_fail_explicitly() {
    let output = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .args(["--trace-api-ignore", "window.document", "fetch", "about:blank"])
        .output().unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("retired descriptor monitor"));
}

#[test]
fn native_trace_captures_complete_console_strings() {
    let directory = directory();
    let path = directory.join("console.log");
    let output = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .arg("--trace-op-file").arg(&path)
        .args(["fetch", "data:text/html,<script>console.log('payloadJSON:'+JSON.stringify({value:'x'.repeat(8192),tail:'complete'}));</script>",
            "--wait", "0", "--timeout", "5", "--quiet"])
        .env_remove("OBSCURA_TRACE_API_FILE")
        .env_remove("OBSCURA_V8_FLAGS")
        .output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let trace = std::fs::read_to_string(path).unwrap();
    assert!(trace.contains(&"x".repeat(8192)));
    assert!(trace.contains("\"tail\":\"complete\""));
    std::fs::remove_dir_all(directory).unwrap();
}
