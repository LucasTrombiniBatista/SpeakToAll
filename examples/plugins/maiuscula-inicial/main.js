// Plugin de exemplo. O host injeta a classe base: module.exports = ({ Plugin }) => class extends Plugin {}.
module.exports = ({ Plugin }) => class MaiusculaInicial extends Plugin {
  async onload() {
    const data = (await this.loadData()) || { addPeriod: true };
    this.settings = data;

    this.addTextProcessor((text) => {
      let out = text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
      if (this.settings.addPeriod && out && !/[.!?…:;]$/.test(out)) out += '.';
      return out;
    });

    this.addCommand({
      id: 'toggle-period',
      name: 'Ligar/desligar ponto final',
      run: async () => {
        this.settings.addPeriod = !this.settings.addPeriod;
        await this.saveData(this.settings);
        this.notify(this.settings.addPeriod ? 'Ponto final ligado' : 'Ponto final desligado');
      },
    });
  }
};
