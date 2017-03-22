export const link = { regex: [/<a.*(?:data-|\s)href=(['"]?)\s*([^"']+?)\s*\1/g, 2] };
export const image = { regex: [/<img.*(?:data-|\s)src=(['"]?)\s*(\S+?)\s*\1/g, 2] };
export const iframe = { regex: [/<iframe.*(?:data-|\s)src=(['"]?)\s*(\S+?)\s*\1/g, 2] };