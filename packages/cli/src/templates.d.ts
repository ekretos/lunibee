/** Project templates, bundled as text (`import … with { type: "text" }`). */
declare module "*.tmpl" {
    const text: string;
    export default text;
}
