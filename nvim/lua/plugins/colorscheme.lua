return {
  {
    "fnzaid/mesopic.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      require("mesopic").setup({})
      vim.cmd.colorscheme("mesopic")
    end,
  },

  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "mesopic",
    },
  },
}
