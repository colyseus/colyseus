import { useEffect, useState } from 'react';

interface JSONSchemaFieldsProps {
	schema: {
		properties?: Record<string, any>;
		required?: string[];
	};
	values: Record<string, any>;
	onChange: (key: string, value: any) => void;
}

// Helper function to create default value based on schema
function getDefaultValue(schema: any): any {
	const type = schema.type || 'string';

	if (type === 'boolean') return false;
	if (type === 'number' || type === 'integer') return 0;
	if (type === 'array') return [];
	if (type === 'object') {
		// Create object with default values for required fields
		const obj: any = {};
		if (schema.properties) {
			Object.entries(schema.properties).forEach(([key, propSchema]: [string, any]) => {
				if (schema.required?.includes(key)) {
					obj[key] = getDefaultValue(propSchema);
				}
			});
		}
		return obj;
	}
	return '';
}

// Array field component with auto-focus support
function ArrayField({ fieldKey, itemSchema, arrayValue, onChange }: {
	fieldKey: string;
	itemSchema: any;
	arrayValue: any[];
	onChange: (value: any) => void;
}) {
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const itemType = itemSchema.type || 'string';

	// Reset focus after it's been applied
	useEffect(() => {
		if (focusIndex !== null) {
			setFocusIndex(null);
		}
	}, [arrayValue.length]);

	return (
		<div className="space-y-2">
			{arrayValue.map((item: any, index: number) => (
				<div key={index} className="flex gap-2 items-start">
					<div className="flex-1">
						{renderField(
							`${fieldKey}[${index}]`,
							itemSchema,
							item,
							(newValue) => {
								const newArray = [...arrayValue];
								newArray[index] = newValue;
								onChange(newArray);
							},
							false,
							focusIndex === index
						)}
					</div>
					<button
						type="button"
						onClick={() => {
							const newArray = arrayValue.filter((_, i) => i !== index);
							onChange(newArray.length > 0 ? newArray : undefined);
						}}
						className="px-2 py-2 text-xs border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
						title="Remove item"
					>
						✕
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={() => {
					const newArray = [...arrayValue];
					const defaultValue = getDefaultValue(itemSchema);
					newArray.push(defaultValue);
					setFocusIndex(newArray.length - 1);
					onChange(newArray);
				}}
				className="w-full px-3 py-2 text-xs border border-dashed border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-400 transition-colors"
			>
				+ Add Item
			</button>
		</div>
	);
}

// Render individual field based on schema type
function renderField(
	key: string,
	fieldSchema: any,
	value: any,
	onChange: (value: any) => void,
	isRequired: boolean,
	autoFocus?: boolean
): JSX.Element | null {
	const type = fieldSchema.type || 'string';

	// Boolean field
	if (type === 'boolean') {
		return (
			<select
				value={value !== undefined ? String(value) : ''}
				onChange={(e) => {
					const val = e.target.value === '' ? undefined : e.target.value === 'true';
					onChange(val);
				}}
				required={isRequired}
				className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
			>
				<option value="">-- Select --</option>
				<option value="true">true</option>
				<option value="false">false</option>
			</select>
		);
	}

	// Number/Integer field
	if (type === 'number' || type === 'integer') {
		return (
			<input
				type="number"
				value={value || ''}
				onChange={(e) => {
					const val = e.target.value === '' ? undefined : (type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value));
					onChange(val);
				}}
				placeholder={fieldSchema.default !== undefined ? String(fieldSchema.default) : ''}
				required={isRequired}
				min={fieldSchema.minimum}
				max={fieldSchema.maximum}
				autoFocus={autoFocus}
				className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
			/>
		);
	}

	// Enum field
	if (fieldSchema.enum) {
		return (
			<select
				value={value || ''}
				onChange={(e) => {
					const val = e.target.value === '' ? undefined : e.target.value;
					onChange(val);
				}}
				required={isRequired}
				className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
			>
				<option value="">-- Select --</option>
				{fieldSchema.enum.map((option: any) => (
					<option key={option} value={option}>{option}</option>
				))}
			</select>
		);
	}

	// Array field
	if (type === 'array') {
		const arrayValue = Array.isArray(value) ? value : [];
		const itemSchema = fieldSchema.items || { type: 'string' };
		const itemType = itemSchema.type || 'string';

		return (
			<ArrayField
				fieldKey={key}
				itemSchema={itemSchema}
				arrayValue={arrayValue}
				onChange={onChange}
			/>
		);
	}

	// Object field
	if (type === 'object') {
		const objectValue = value || {};
		const properties = fieldSchema.properties || {};
		const requiredFields = fieldSchema.required || [];

		return (
			<div className="border border-gray-300 dark:border-slate-600 rounded p-3 space-y-3 bg-gray-50 dark:bg-slate-900/50">
				{Object.entries(properties).map(([propKey, propSchema]: [string, any]) => {
					const isPropRequired = requiredFields.includes(propKey);
					const propDescription = (propSchema as any).description;

					return (
						<div key={propKey}>
							<label className="block text-xs mb-1 dark:text-slate-300">
								<code className="font-mono">{propKey}</code>
								{isPropRequired && <span className="text-red-500 ml-1">*</span>}
								{propDescription && (
									<span className="text-gray-500 dark:text-slate-400 font-normal ml-2">
										{propDescription}
									</span>
								)}
							</label>
							{renderField(
								`${key}.${propKey}`,
								propSchema,
								objectValue[propKey],
								(newValue) => {
									const newObject = { ...objectValue };
									if (newValue === undefined) {
										delete newObject[propKey];
									} else {
										newObject[propKey] = newValue;
									}
									onChange(newObject);
								},
								isPropRequired,
								autoFocus
							)}
						</div>
					);
				})}
			</div>
		);
	}

	// String field (default)
	return (
		<input
			type="text"
			value={value || ''}
			onChange={(e) => {
				const val = e.target.value === '' ? undefined : e.target.value;
				onChange(val);
			}}
			placeholder={fieldSchema.default !== undefined ? String(fieldSchema.default) : ''}
			required={isRequired}
			minLength={fieldSchema.minLength}
			maxLength={fieldSchema.maxLength}
			pattern={fieldSchema.pattern}
			autoFocus={autoFocus}
			className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
		/>
	);
}

export function JSONSchemaFields({ schema, values, onChange }: JSONSchemaFieldsProps) {
	if (!schema || !schema.properties) {
		return null;
	}

	return (
		<div className="space-y-3">
			{Object.entries(schema.properties).map(([key, fieldSchema]: [string, any]) => {
				const isRequired = schema.required?.includes(key);
				const type = fieldSchema.type || 'string';
				const description = fieldSchema.description;

				return (
					<div key={key}>
						<label className="block text-xs mb-1 dark:text-slate-300">
							<code className="font-mono">{key}</code>
							{isRequired && <span className="text-red-500 ml-1">*</span>}
							{description && (
								<span className="text-gray-500 dark:text-slate-400 font-normal ml-2">
									{description}
								</span>
							)}
						</label>
						{renderField(
							key,
							fieldSchema,
							values[key],
							(value) => onChange(key, value),
							isRequired || false
						)}
					</div>
				);
			})}
		</div>
	);
}

