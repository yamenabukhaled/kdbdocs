# STAT2010 Lab 4: residual diagnostics
housing <- read.csv("housing.csv")
fit <- lm(price ~ area + bedrooms, data = housing)
summary(fit)
par(mfrow = c(2, 2))
plot(fit)  # check residuals vs fitted, QQ plot
# Exercise: add log(area) and compare adjusted R squared
fit2 <- lm(price ~ log(area) + bedrooms, data = housing)
summary(fit2)$adj.r.squared
