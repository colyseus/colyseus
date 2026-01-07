import type { MonitorOptions } from "../../";

export type ExtractStringNames<T> = T extends (infer U)[] ? U extends string ? U : never : never;

export const valueFormatter: { [key in ExtractStringNames<MonitorOptions['columns']>]?: Function } = {
  elapsedTime: (params) => {
    if (params.value && params.value.getTime) {
      return humanizeElapsedTime(Date.now() - params.value.getTime());
    } else {
      return "";
    }
  }
}

export function humanizeElapsedTime(milliseconds: number) {
  if (milliseconds < 0) { return ""; }
  let temp = Math.floor(milliseconds / 1000);
  const years = Math.floor(temp / 31536000);
  if (years) { return years + 'y'; }
  const days = Math.floor((temp %= 31536000) / 86400);
  if (days) { return days + 'd'; }
  const hours = Math.floor((temp %= 86400) / 3600);
  if (hours) { return hours + 'h'; }
  const minutes = Math.floor((temp %= 3600) / 60);
  if (minutes) { return minutes + 'min'; }
  const seconds = temp % 60;
  if (seconds) { return seconds + 's'; }
  return 'less than a second';
}
