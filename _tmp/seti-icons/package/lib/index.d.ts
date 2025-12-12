interface SetiTheme {
    blue: string;
    grey: string;
    "grey-light": string;
    green: string;
    orange: string;
    pink: string;
    purple: string;
    red: string;
    white: string;
    yellow: string;
    ignore: string;
}
declare type Color = keyof SetiTheme;
interface Icon {
    svg: string;
    color: Color;
}
interface ThemedIcon {
    svg: string;
    color: string;
}
declare const getIcon: (fileName: string) => Icon;
declare const themeIcons: (theme: SetiTheme) => (fileName: string) => ThemedIcon;
export { getIcon, themeIcons };
