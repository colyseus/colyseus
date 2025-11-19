export function Timestamp({ date }: { date: Date }) {
	return <>
		{
			String(date.getHours()).padStart(2, "0") // hours
		}:{
			String(date.getMinutes()).padStart(2, "0") // minutes
		}:{
			String(date.getSeconds()).padStart(2, "0") // seconds
		}.{
			String(date.getMilliseconds()).padStart(3, "0") // milliseconds
		}
	</>;
}