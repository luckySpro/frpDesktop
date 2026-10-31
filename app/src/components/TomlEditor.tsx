import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";

const lang = StreamLanguage.define(toml);

export default function TomlEditor({ value, onChange, dark }: { value: string; onChange: (v: string) => void; dark: boolean }) {
  return (
    <div className="cm-wrap mono">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[lang]}
        theme={dark ? "dark" : "light"}
        minHeight="420px"
        maxHeight="calc(100vh - 260px)"
        basicSetup={{ foldGutter: false, highlightActiveLine: true }}
      />
    </div>
  );
}
