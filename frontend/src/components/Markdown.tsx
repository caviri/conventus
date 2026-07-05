import { renderContent, splitSegments } from "../format";
import CodeBlock from "./CodeBlock";
import HtmlWidget from "./HtmlWidget";
import MermaidBlock from "./MermaidBlock";

// Renders markdown-ish content: text (links, bold, mentions, inline code),
// ```lang code blocks (highlighted), ```mermaid diagrams (rendered to SVG),
// and ```html sandboxed widgets.
export default function Markdown({ content }: { content: string }) {
  return (
    <div className="msg-content leading-relaxed">
      {splitSegments(content).map((seg, i) =>
        seg.type === "html" ? (
          <HtmlWidget key={i} html={seg.value} />
        ) : seg.type === "code" && seg.lang === "mermaid" ? (
          <MermaidBlock key={i} code={seg.value} />
        ) : seg.type === "code" ? (
          <CodeBlock key={i} code={seg.value} lang={seg.lang} />
        ) : (
          seg.value.trim() && (
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: renderContent(seg.value) }}
            />
          )
        )
      )}
    </div>
  );
}
