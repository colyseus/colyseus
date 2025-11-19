import React, { useEffect, useRef } from "react";

import JSONEditorModule, { JSONEditorOptions } from "jsoneditor";
import ace from 'ace-builds';


import "jsoneditor/dist/jsoneditor.css";
import './JSONEditor.css';

export function JSONEditor ({
	json,
	text,
	className,
	maxLines,
	...props
}: JSONEditorOptions & {
	json?: any,
	text?: string,
	maxLines?: number,
	className?: string
}) {
  const containerRef = useRef(null);
  const editorRef = useRef<JSONEditorModule | null>(null);

	const updateText = () => {
		if (json) {
			editorRef.current!.set(json);

		} else if (text) {
			editorRef.current!.updateText(text);
		}
	}

  useEffect(() => {
    if (containerRef.current) {
			const options = { ...props };
      editorRef.current = new JSONEditorModule(containerRef.current, options);
			updateText();
    }

		const aceEditor = editorRef.current?.aceEditor;
		if (aceEditor) {
			aceEditor.setOptions({
				autoScrollEditorIntoView: true,
				maxLines: maxLines || 5,
				// highlightSelectedWord: true,
				showLineNumbers: false,
				enableAutoIndent: true,
			})

			aceEditor.resize();
		}

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
    };
  }, []);

	useEffect(() => {
		if (editorRef.current) {
			updateText();
		}
	}, [json, text]);

  return <div className={"w-full " + (className || "")} ref={containerRef} />;
};
