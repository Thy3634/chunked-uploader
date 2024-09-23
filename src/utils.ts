export function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}
