let value1 = Math.random();
let value2 = Math.random();
function update_value2() {
    value2 = Math.random();
}
<span>value1:\{value1}&#36;</span>;
let btn1 = <button onclick="${update_value2}">value2:\{value2}</button>;
let list = ["a", "b", "c"];
let dynamic_fragments = [];
for (const text of list) {
    if (Math.random() < 0.5) {
        dynamic_fragments.push(
            /^\s|\s$/.test(text) ?
                <strong>\{
                    `${dynamic_fragments.length}:${text}`
                }</strong> :
                <span>\{
                    `${dynamic_fragments.length}:${text}`
                }</span>
        );
    }
}
list.reverse().forEach(
    (text, index) => {
        if (text && text.charCodeAt(0) < 99) {
            dynamic_fragments.push(
                <span>\{
                    `${dynamic_fragments.length}:${text}`
                }</span>
            );
        }
    }
);
let static_list = \{ list };
let static_fragments = static_list.map(
    (text, index) => <span>\{
        `${index}:${text}`
    }</span>
);
for (const index in static_list) {
    <span>\{
        `${index}:${static_list[index]}`
    }</span>
}
setTimeout(
    () => {
        list.splice(1, 1);
        list.push("d", " e", "f");
        list[list.length] = "g";
    }, 3000
);
export {
    update_value2,
    list as dynamic_list
}